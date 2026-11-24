/**
 * AI agent node runtime. One "turn" = the contact sent a message while a run is waiting on an aiAgent node.
 *   beginTurn (mutation: lock, quota, load context) → LLM call (action) → finishTurn (mutation: usage, tools, lock).
 * Uses the plain AI SDK (generateText + tools) so it works with any provider (see ai/provider.ts, D10).
 */
import { generateText, isStepCount, tool } from "ai";
import { v } from "convex/values";
import { z } from "zod";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { graphSchema } from "../engine/graph";
import { advance } from "../engine/runner";
import { estimateCostMicros } from "./pricing";
import { buildSystemPrompt, toModelMessages } from "./prompt";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "./models";
import { getLanguageModel } from "./provider";
import { recordTokens, reserveAiReply } from "./quota";

/** Overridable in tests. */
export const deps = { getModel: getLanguageModel };

const LOCK_MS = 120_000;

export const beginTurn = internalMutation({
  args: { runId: v.id("flowRuns") },
  handler: async (ctx, { runId }) => {
    const now = Date.now();
    const run = await ctx.db.get(runId);
    if (!run || run.status !== "waiting" || run.waitingFor !== "ai") return { status: "skip" as const };
    if (run.aiLockUntil && run.aiLockUntil > now) return { status: "busy" as const };
    const conv = await ctx.db.get(run.conversationId);
    if (!conv || conv.mode === "human") return { status: "skip" as const };

    if (!(await reserveAiReply(ctx, run.orgId, now))) {
      await advance(ctx, runId, { kind: "aiQuotaExceeded" });
      return { status: "quota" as const };
    }

    const ver = await ctx.db.get(run.flowVersionId);
    const graph = graphSchema.safeParse(ver?.graph);
    const node = graph.success ? graph.data.nodes.find((n) => n.id === run.currentNodeId) : undefined;
    const settings = await ctx.db.query("orgSettings").withIndex("by_org", (q) => q.eq("orgId", run.orgId)).unique();
    // Provider, model and keys are decided by the platform (superAdmin), not by each workspace.
    const platform = await ctx.db.query("platformSettings").withIndex("by_key", (q) => q.eq("key", "ai")).unique();
    if (!node || node.type !== "aiAgent" || !settings) return { status: "skip" as const };

    const contact = await ctx.db.get(run.contactId);
    const knowledge = node.useKnowledge
      ? await ctx.db.query("knowledge").withIndex("by_org", (q) => q.eq("orgId", run.orgId)).collect()
      : [];
    const recent = (
      await ctx.db.query("messages").withIndex("by_conversation", (q) => q.eq("conversationId", conv._id)).order("desc").take(30)
    ).reverse();

    await ctx.db.patch(runId, { aiLockUntil: now + LOCK_MS });
    const lastInboundAt = recent.filter((m) => m.direction === "in").at(-1)?.sentAt ?? now;
    return {
      status: "ok" as const,
      lastInboundAt,
      settings: {
        aiProvider: platform?.aiProvider ?? DEFAULT_PROVIDER, aiModel: node.model ?? platform?.aiModel ?? DEFAULT_MODEL,
        byoAnthropicKeyEnc: platform?.anthropicKeyEnc, byoOpenRouterKeyEnc: platform?.openRouterKeyEnc,
      },
      system: buildSystemPrompt({
        orgInstructions: settings.aiInstructions,
        nodeInstructions: node.instructions,
        exitWhen: node.exitWhen,
        knowledge: knowledge.map((k) => ({ title: k.title, content: k.content })),
        contactName: contact?.name ?? contact?.username,
        language: settings.defaultLanguage,
      }),
      messages: toModelMessages(recent.map((m) => ({ direction: m.direction, text: m.text }))),
    };
  },
});

const outcome = v.object({
  exit: v.optional(v.string()),
  handoff: v.optional(v.string()),
  fields: v.array(v.object({ key: v.string(), value: v.string() })),
});

export const finishTurn = internalMutation({
  args: {
    runId: v.id("flowRuns"),
    usage: v.optional(v.object({ inputTokens: v.number(), outputTokens: v.number(), costUsdMicros: v.number() })),
    outcome: v.optional(outcome),
    error: v.optional(v.string()),
    lastInboundAt: v.number(),
  },
  handler: async (ctx, a) => {
    const run = await ctx.db.get(a.runId);
    if (!run) return;
    const now = Date.now();
    if (a.usage) await recordTokens(ctx, run.orgId, a.usage, now);
    await ctx.db.patch(a.runId, { aiLockUntil: undefined });
    const conv = await ctx.db.get(run.conversationId);
    const contact = await ctx.db.get(run.contactId);
    if (!conv || !contact) return;

    const note = (text: string) =>
      ctx.db.insert("notes", { orgId: run.orgId, conversationId: conv._id, contactId: contact._id, text, author: "ai", createdAt: now });

    if (a.error) {
      await note(`AI error, conversation handed to a person: ${a.error.slice(0, 200)}`);
      await ctx.db.patch(conv._id, { mode: "human" });
      await ctx.db.patch(a.runId, { status: "failed", error: "ai_error", endedAt: now, waitingFor: undefined });
      return;
    }

    const o = a.outcome;
    if (o?.fields.length) {
      const fields = { ...contact.fields };
      for (const f of o.fields) fields[f.key] = f.value;
      await ctx.db.patch(contact._id, { fields });
    }
    if (o?.handoff !== undefined) {
      await note(`AI handed off to a person: ${o.handoff || "no reason given"}`);
      await ctx.db.patch(conv._id, { mode: "human" });
      await ctx.db.patch(a.runId, { status: "done", endedAt: now, waitingFor: undefined });
      return;
    }
    if (o?.exit !== undefined) {
      // Small delay so the AI's last reply is delivered before the next node's messages.
      await ctx.scheduler.runAfter(1500, internal.engine.runner.resume, { runId: a.runId, kind: "aiExit" });
      return;
    }
    // The contact wrote again while we were thinking: answer that too.
    const newer = await ctx.db
      .query("messages").withIndex("by_conversation", (q) => q.eq("conversationId", conv._id).gt("sentAt", a.lastInboundAt)).collect();
    if (newer.some((m) => m.direction === "in")) await ctx.scheduler.runAfter(0, internal.ai.agent.reply, { runId: a.runId });
  },
});

/** Contact message → AI reply. Safe to call repeatedly: a lock makes concurrent calls no-ops. */
export const reply = internalAction({
  args: { runId: v.id("flowRuns") },
  handler: async (ctx, { runId }) => {
    const turn = await ctx.runMutation(internal.ai.agent.beginTurn, { runId });
    if (turn.status !== "ok") return;

    const result: { exit?: string; handoff?: string; fields: { key: string; value: string }[] } = { fields: [] };
    try {
      const model = await deps.getModel(turn.settings);
      const gen = await generateText({
        model,
        system: turn.system,
        messages: turn.messages,
        maxOutputTokens: 400,
        stopWhen: isStepCount(3),
        tools: {
          handoff_to_human: tool({
            description: "Hand the conversation to a human. Use when you cannot help or the customer asks for a person.",
            inputSchema: z.object({ reason: z.string().max(300) }),
            execute: async ({ reason }) => { result.handoff = reason; return "ok"; },
          }),
          exit_flow: tool({
            description: "End the AI conversation because the exit condition was met.",
            inputSchema: z.object({ reason: z.string().max(300) }),
            execute: async ({ reason }) => { result.exit = reason; return "ok"; },
          }),
          save_lead_field: tool({
            description: "Save a piece of customer information (name, phone, email, address, interest).",
            inputSchema: z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/), value: z.string().max(300) }),
            execute: async ({ key, value }) => { result.fields.push({ key, value }); return "saved"; },
          }),
        },
      });

      const text = gen.text.trim();
      const run = await ctx.runQuery(internal.ai.agent.convOf, { runId });
      if (text && run && result.handoff === undefined) {
        await ctx.runMutation(internal.ai.agent.deliverAi, { runId, text: text.slice(0, 1000) });
      }
      const inT = gen.totalUsage?.inputTokens ?? 0;
      const outT = gen.totalUsage?.outputTokens ?? 0;
      await ctx.runMutation(internal.ai.agent.finishTurn, {
        runId, lastInboundAt: turn.lastInboundAt, outcome: result,
        usage: { inputTokens: inT, outputTokens: outT, costUsdMicros: estimateCostMicros(turn.settings.aiModel, inT, outT).micros },
      });
    } catch (e) {
      await ctx.runMutation(internal.ai.agent.finishTurn, {
        runId, lastInboundAt: turn.lastInboundAt, error: e instanceof Error ? e.message : String(e),
      });
    }
  },
});


export const convOf = internalQuery({
  args: { runId: v.id("flowRuns") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    return run ? { conversationId: run.conversationId as Id<"conversations"> } : null;
  },
});

/** Schedules the delivery of the AI text (kept as a mutation so scheduling is atomic with the run lookup). */
export const deliverAi = internalMutation({
  args: { runId: v.id("flowRuns"), text: v.string() },
  handler: async (ctx, { runId, text }) => {
    const run = await ctx.db.get(runId);
    if (!run) return;
    await ctx.scheduler.runAfter(0, internal.outbound.deliver, {
      conversationId: run.conversationId, items: [{ text }], source: "ai", runId,
    });
  },
});
