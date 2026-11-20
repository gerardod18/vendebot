/**
 * Flow runner: executes the pure interpreter (`step`) and applies its effects durably.
 * Durability = every transition is persisted in `flowRuns`; waits are scheduler timeouts guarded by
 * `waitSeq`, so stale timers are ignored. See DECISIONS D10 (scheduler instead of the Workflow component).
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { aiQuotaAvailable } from "../ai/quota";
import type { InboundEvent } from "../instagram/parse";
import { isWithinBusinessHours } from "../lib/time";
import { graphSchema, type Graph } from "./graph";
import { initialState, step, type Effect, type ResumeInput, type RunState } from "./interpreter";
import { routeEvent, type RouteInput, type TriggerDef } from "./router";

const MIN = 60_000;

async function loadGraph(ctx: MutationCtx, versionId: Id<"flowVersions">): Promise<Graph | null> {
  const ver = await ctx.db.get(versionId);
  const parsed = graphSchema.safeParse(ver?.graph);
  return parsed.success ? parsed.data : null;
}

/** Run the interpreter once and apply everything it asks for. */
export async function advance(
  ctx: MutationCtx,
  runId: Id<"flowRuns">,
  input?: ResumeInput,
  opts: { respondNow?: boolean } = {},
): Promise<void> {
  const run = await ctx.db.get(runId);
  if (!run || run.status === "done" || run.status === "failed" || run.status === "cancelled") return;
  const [contact, conv, graph, settings] = await Promise.all([
    ctx.db.get(run.contactId),
    ctx.db.get(run.conversationId),
    loadGraph(ctx, run.flowVersionId),
    ctx.db.query("orgSettings").withIndex("by_org", (q) => q.eq("orgId", run.orgId)).unique(),
  ]);
  if (!contact || !conv || !settings) {
    await ctx.db.patch(runId, { status: "failed", error: "missing_context", endedAt: Date.now() });
    return;
  }
  if (!graph) {
    await ctx.db.patch(runId, { status: "failed", error: "invalid_graph", endedAt: Date.now() });
    return;
  }

  const prev: RunState = {
    status: run.status === "waiting" ? "waiting" : "running",
    nodeId: run.currentNodeId ?? null,
    waitingFor: run.waitingFor,
    vars: run.vars,
  };
  const { state, effects } = step(
    graph,
    prev,
    {
      contact: { name: contact.name, username: contact.username, tags: contact.tags, fields: contact.fields },
      inBusinessHours: isWithinBusinessHours(settings.businessHours, settings.timezone),
      aiQuotaAvailable: await aiQuotaAvailable(ctx, run.orgId),
    },
    input,
  );

  const seq = (run.waitSeq ?? 0) + 1;
  const now = Date.now();
  let tags = contact.tags;
  let fields = contact.fields;
  const sends: { text: string; quickReplies?: { title: string; payload: string }[] }[] = [];
  let handedOff = false;
  let replyToCommentId = run.replyToCommentId;

  const flushSends = async () => {
    if (!sends.length) return;
    await ctx.scheduler.runAfter(0, internal.outbound.deliver, {
      conversationId: conv._id, items: sends.splice(0), source: "bot", replyToCommentId, runId,
    });
    replyToCommentId = undefined; // only the first send may be a private reply
  };

  for (const e of effects as Effect[]) {
    switch (e.type) {
      case "send": sends.push({ text: e.text, quickReplies: e.quickReplies }); break;
      case "addTag": if (!tags.includes(e.tag)) tags = [...tags, e.tag]; break;
      case "setField": fields = { ...fields, [e.key]: e.value }; break;
      case "note":
        await ctx.db.insert("notes", { orgId: run.orgId, conversationId: conv._id, contactId: contact._id, text: e.text, author: "bot", createdAt: now });
        break;
      case "http": await ctx.scheduler.runAfter(0, internal.outbound.httpCall, { url: e.url, method: e.method, body: e.body }); break;
      case "handoff":
        if (e.message) sends.push({ text: e.message });
        handedOff = true;
        break;
      case "scheduleTimeout":
        await ctx.scheduler.runAfter(e.minutes * MIN, internal.engine.runner.onTimeout, {
          runId, seq, reason: e.reason === "wait" ? "timer" : "timeout",
        });
        break;
      case "startAi":
        if (opts.respondNow) await ctx.scheduler.runAfter(0, internal.ai.agent.reply, { runId });
        break;
    }
  }
  await flushSends();

  if (tags !== contact.tags || fields !== contact.fields) await ctx.db.patch(contact._id, { tags, fields });
  if (handedOff) await ctx.db.patch(conv._id, { mode: "human" });

  const ended = state.status === "done" || state.status === "failed";
  await ctx.db.patch(runId, {
    status: state.status === "running" ? "running" : state.status,
    currentNodeId: state.nodeId ?? undefined,
    waitingFor: state.status === "waiting" ? state.waitingFor : undefined,
    vars: state.vars,
    error: state.error,
    waitSeq: seq,
    replyToCommentId: undefined,
    ...(ended ? { endedAt: now } : {}),
  });
}

/** Stale timers (older waitSeq) and runs no longer waiting are ignored. */
export const onTimeout = internalMutation({
  args: { runId: v.id("flowRuns"), seq: v.number(), reason: v.union(v.literal("timer"), v.literal("timeout")) },
  handler: async (ctx, { runId, seq, reason }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.status !== "waiting" || run.waitSeq !== seq) return;
    await advance(ctx, runId, { kind: reason });
  },
});

/** Called by the AI agent when it finishes a turn that ends the AI node. */
export const resume = internalMutation({
  args: {
    runId: v.id("flowRuns"),
    kind: v.union(v.literal("aiExit"), v.literal("aiQuotaExceeded"), v.literal("timeout")),
  },
  handler: async (ctx, { runId, kind }) => {
    await advance(ctx, runId, { kind });
  },
});

async function cancelActiveRuns(ctx: MutationCtx, conversationId: Id<"conversations">) {
  for (const status of ["waiting", "running"] as const) {
    const runs = await ctx.db
      .query("flowRuns")
      .withIndex("by_conversation_status", (q) => q.eq("conversationId", conversationId).eq("status", status))
      .collect();
    for (const r of runs) await ctx.db.patch(r._id, { status: "cancelled", endedAt: Date.now(), waitingFor: undefined });
  }
}
export { cancelActiveRuns };

function toRouteInput(e: InboundEvent, isFirstContact: boolean): RouteInput {
  switch (e.type) {
    case "message": return { kind: "message", text: e.text, quickReplyPayload: e.quickReplyPayload, isFirstContact };
    case "postback": return { kind: "postback", payload: e.payload };
    case "comment": return { kind: "comment", text: e.text, mediaId: e.mediaId, isReply: e.isReply };
    case "story_mention": return { kind: "storyMention" };
  }
}

/** Entry point for every newly ingested event (scheduled from the webhook handler). */
export const processInbound = internalMutation({
  args: {
    event: v.any(),
    conversationId: v.id("conversations"),
    contactId: v.id("contacts"),
    igAccountId: v.id("igAccounts"),
    isFirstContact: v.boolean(),
  },
  handler: async (ctx, a) => {
    const event = a.event as InboundEvent;
    const conv = await ctx.db.get(a.conversationId);
    if (!conv) return;
    const markProcessed = async (error?: string) => {
      const row = await ctx.db.query("webhookEvents").withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", event.dedupeKey)).first();
      if (row) await ctx.db.patch(row._id, { processedAt: Date.now(), ...(error ? { error } : {}) });
    };

    if (a.isFirstContact && event.type !== "comment") {
      await ctx.scheduler.runAfter(0, internal.instagram.profile.fetchProfile, { contactId: a.contactId });
    }
    if (conv.mode === "human") return markProcessed(); // a person owns this conversation

    // 1) A run waiting on this contact wins.
    if (event.type === "message" || event.type === "postback") {
      const waiting = await ctx.db
        .query("flowRuns")
        .withIndex("by_conversation_status", (q) => q.eq("conversationId", conv._id).eq("status", "waiting"))
        .first();
      if (waiting?.waitingFor === "ai") {
        await ctx.scheduler.runAfter(0, internal.ai.agent.reply, { runId: waiting._id });
        return markProcessed();
      }
      if (waiting?.waitingFor === "reply") {
        await advance(ctx, waiting._id, {
          kind: "reply",
          text: event.type === "message" ? event.text : undefined,
          payload: event.type === "message" ? event.quickReplyPayload : event.payload,
        });
        return markProcessed();
      }
    }

    // 2) Otherwise route to a trigger.
    const rows = await ctx.db.query("triggers").withIndex("by_account", (q) => q.eq("igAccountId", a.igAccountId)).collect();
    const defs: TriggerDef[] = rows.map((t) => ({ id: t._id, type: t.type, enabled: t.enabled, priority: t.priority, config: t.config ?? {} }));
    const hit = routeEvent(toRouteInput(event, a.isFirstContact), defs);
    if (!hit) return markProcessed();
    const trigger = rows.find((t) => t._id === hit.id)!;
    const flow = await ctx.db.get(trigger.flowId);
    if (!flow || flow.archived || !flow.activeVersionId) return markProcessed("flow_unavailable");
    const graph = await loadGraph(ctx, flow.activeVersionId);
    if (!graph) return markProcessed("invalid_graph");

    await cancelActiveRuns(ctx, conv._id);
    const runId = await ctx.db.insert("flowRuns", {
      orgId: conv.orgId,
      flowVersionId: flow.activeVersionId,
      contactId: a.contactId,
      conversationId: conv._id,
      status: "running",
      currentNodeId: initialState(graph).nodeId ?? undefined,
      vars: {},
      replyToCommentId: event.type === "comment" ? event.commentId : undefined,
    });
    await ctx.db.patch(trigger._id, { firedCount: trigger.firedCount + 1 });
    if (event.type === "comment" && typeof trigger.config?.publicReply === "string" && trigger.config.publicReply.trim()) {
      await ctx.scheduler.runAfter(0, internal.outbound.publicReply, {
        conversationId: conv._id, commentId: event.commentId, text: trigger.config.publicReply.trim(),
      });
    }
    await advance(ctx, runId, undefined, { respondNow: event.type === "message" });
    return markProcessed();
  },
});

export type { Doc };
