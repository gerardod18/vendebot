import { convexTest } from "convex-test";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import { deps } from "../convex/ai/agent";
import { encryptSecret } from "../convex/lib/crypto";
import { parseWebhook } from "../convex/instagram/parse";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
const ME = "1784000000";
const KEY = Buffer.alloc(32, 9).toString("base64");

let sent: any[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
  sent = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
    if (String(url).includes("/messages")) {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ message_id: `out${sent.length}`, recipient_id: "user1" }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

async function seed(opts: { template?: any; keywords?: string[]; aiQuota?: number; hours?: boolean } = {}) {
  const t = convexTest(schema, modules);
  const tokenEnc = await encryptSecret("tok", KEY);
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("orgs", { name: "Org", slug: "org", createdBy: "u1" });
    await ctx.db.insert("members", { orgId, userId: "u1", role: "owner" });
    await ctx.db.insert("orgSettings", {
      orgId, plan: "free", aiModel: "claude-haiku-5-5", aiMonthlyQuota: opts.aiQuota ?? 200, timezone: "UTC",
      businessHours: opts.hours === false ? { days: [], start: "00:00", end: "00:00" } : { days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59" },
      defaultLanguage: "es",
    });
    const igAccountId = await ctx.db.insert("igAccounts", {
      orgId, igUserId: ME, username: "tienda", tokenEnc, tokenExpiresAt: Date.now() + 1e10,
      status: "active", webhookSubscribed: true, connectedBy: "u1",
    });
    return { orgId, igAccountId };
  });
  const as = t.withIdentity({ subject: "u1" });
  const { api } = await import("../convex/_generated/api");
  await as.mutation(api.automations.create, {
    orgId: ids.orgId, igAccountId: ids.igAccountId, name: "auto",
    template: opts.template ?? { key: "keywordReply", text: "Hola {{first_name}}, el precio es $10" },
    keywords: opts.keywords ?? ["precio"],
  });
  return { t, as, ...ids };
}

const dm = (mid: string, text: string, ts = Date.now()) =>
  parseWebhook({ object: "instagram", entry: [{ id: ME, time: 1, messaging: [
    { sender: { id: "user1" }, recipient: { id: ME }, timestamp: ts, message: { mid, text } }] }] });

async function receive(t: any, events: any[]) {
  const res = await t.mutation(internal.engine.ingest.ingestEvents, { events });
  for (const a of res.accepted) {
    await t.mutation(internal.engine.runner.processInbound, {
      event: a.event, conversationId: a.conversationId, contactId: a.contactId, igAccountId: a.igAccountId, isFirstContact: a.isFirstContact,
    });
  }
  await settle(t);
}

/** Run short scheduled work (deliveries, AI turns) without firing long timeouts (e.g. 60 min AI timeout). */
async function settle(t: any) {
  for (let i = 0; i < 6; i++) {
    vi.advanceTimersByTime(2000);
    await t.finishInProgressScheduledFunctions();
  }
}

describe("runner: keyword reply end to end", () => {
  it("routes a DM to the flow, sends the reply and records it", async () => {
    const { t } = await seed();
    await receive(t, dm("m1", "¿Precio?"));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ recipient: { id: "user1" }, message: { text: "Hola, el precio es $10" } });
    await t.run(async (ctx) => {
      const out = (await ctx.db.query("messages").collect()).filter((m) => m.direction === "out");
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ status: "sent", source: "bot", mid: "out1" });
      const runs = await ctx.db.query("flowRuns").collect();
      expect(runs[0].status).toBe("done");
      expect((await ctx.db.query("triggers").collect())[0].firedCount).toBe(1);
    });
  });

  it("does nothing for non-matching text and for human-mode conversations", async () => {
    const { t } = await seed();
    await receive(t, dm("m1", "hola"));
    expect(sent).toHaveLength(0);
    await t.run(async (ctx) => {
      const c = (await ctx.db.query("conversations").collect())[0];
      await ctx.db.patch(c._id, { mode: "human" });
    });
    await receive(t, dm("m2", "precio"));
    expect(sent).toHaveLength(0);
  });

  it("fails the run with window_closed when the 24h window has passed", async () => {
    const { t } = await seed();
    await receive(t, dm("m1", "hola", Date.now() - 48 * 3600_000));
    await receive(t, dm("m2", "precio", Date.now() - 48 * 3600_000 + 1000));
    expect(sent).toHaveLength(0);
    await t.run(async (ctx) => {
      const run = (await ctx.db.query("flowRuns").collect())[0];
      expect(run).toMatchObject({ status: "failed", error: "window_closed" });
    });
  });
});

describe("runner: quick replies wait for the next message", () => {
  it("resumes on the tapped payload", async () => {
    const { t } = await seed({
      template: { key: "keywordReply", text: "¿Qué quieres?", quickReplies: [{ title: "Precios", payload: "p" }], handoffAfter: true },
    });
    await receive(t, dm("m1", "precio"));
    expect(sent).toHaveLength(1);
    expect(sent[0].message.quick_replies).toHaveLength(1);
    await receive(t, parseWebhook({ object: "instagram", entry: [{ id: ME, time: 1, messaging: [
      { sender: { id: "user1" }, recipient: { id: ME }, timestamp: Date.now(), message: { mid: "m2", text: "Precios", quick_reply: { payload: "p" } } }] }] }));
    await t.run(async (ctx) => {
      expect((await ctx.db.query("conversations").collect())[0].mode).toBe("human"); // handoff node reached
      expect((await ctx.db.query("flowRuns").collect())[0].status).toBe("done");
    });
  });
});

describe("AI agent turn", () => {
  const aiTemplate = { key: "defaultReply", fallbackText: "Te respondemos pronto", ai: { instructions: "Sell shoes", exitWhen: "customer gives phone" } };
  const modelThatSays = (text: string, tool?: { name: string; input: any }) =>
    new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [
          ...(tool ? [{ type: "tool-call" as const, toolCallId: "c1", toolName: tool.name, input: JSON.stringify(tool.input) }] : []),
          ...(text ? [{ type: "text" as const, text }] : []),
        ],
        finishReason: { unified: tool ? "tool-calls" : "stop", raw: undefined },
        usage: { inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 100, text: 100, reasoning: 0 } },
        warnings: [],
      }),
    } as any);

  it("replies with the model's text, records usage, consumes quota", async () => {
    const { t } = await seed({ template: aiTemplate, keywords: [] });
    deps.getModel = async () => modelThatSays("Tenemos zapatos desde $20") as any;
    await receive(t, dm("m1", "hola, qué venden?"));
    expect(sent.map((s) => s.message.text)).toEqual(["Tenemos zapatos desde $20"]);
    await t.run(async (ctx) => {
      const u = (await ctx.db.query("usage").collect())[0];
      expect(u).toMatchObject({ aiReplies: 1, inputTokens: 1000, outputTokens: 100 });
      expect(u.costUsdMicros).toBeGreaterThan(0);
      expect((await ctx.db.query("flowRuns").collect())[0]).toMatchObject({ status: "waiting", waitingFor: "ai" });
    });
  });

  it("uses the platform provider, model and keys, not workspace settings", async () => {
    const { t } = await seed({ template: aiTemplate, keywords: [] });
    await t.run((ctx) => ctx.db.insert("platformSettings", {
      key: "ai", aiProvider: "openrouter", aiModel: "openai/gpt-5-mini", openRouterKeyEnc: "enc-or", updatedBy: "root", updatedAt: Date.now(),
    }));
    let seen: any;
    deps.getModel = async (settings: any) => { seen = settings; return modelThatSays("ok") as any; };
    await receive(t, dm("m1", "hola"));
    expect(seen).toMatchObject({ aiProvider: "openrouter", aiModel: "openai/gpt-5-mini", byoOpenRouterKeyEnc: "enc-or" });
    expect(sent.map((x) => x.message.text)).toEqual(["ok"]);
  });

  it("falls to the fallback message when the AI quota is exhausted", async () => {
    const { t } = await seed({ template: aiTemplate, keywords: [], aiQuota: 0 });
    deps.getModel = async () => { throw new Error("should not be called"); };
    await receive(t, dm("m1", "hola"));
    expect(sent.map((s) => s.message.text)).toEqual(["Te respondemos pronto"]);
  });

  it("falls to the fallback outside business hours without calling the LLM", async () => {
    const { t } = await seed({ template: aiTemplate, keywords: [], hours: false });
    deps.getModel = async () => { throw new Error("should not be called"); };
    await receive(t, dm("m1", "hola"));
    expect(sent.map((s) => s.message.text)).toEqual(["Te respondemos pronto"]);
  });

  it("handoff tool switches the conversation to human and sends no text", async () => {
    const { t } = await seed({ template: aiTemplate, keywords: [] });
    deps.getModel = async () => modelThatSays("", { name: "handoff_to_human", input: { reason: "wants a person" } }) as any;
    await receive(t, dm("m1", "quiero hablar con alguien"));
    await t.run(async (ctx) => {
      expect((await ctx.db.query("conversations").collect())[0].mode).toBe("human");
      expect((await ctx.db.query("notes").collect())[0].text).toContain("wants a person");
    });
  });

  it("model errors hand the conversation to a person", async () => {
    const { t } = await seed({ template: aiTemplate, keywords: [] });
    deps.getModel = async () => { throw new Error("No API key"); };
    await receive(t, dm("m1", "hola"));
    expect(sent).toHaveLength(0);
    await t.run(async (ctx) => {
      expect((await ctx.db.query("conversations").collect())[0].mode).toBe("human");
      expect((await ctx.db.query("flowRuns").collect())[0]).toMatchObject({ status: "failed", error: "ai_error" });
    });
  });
});
