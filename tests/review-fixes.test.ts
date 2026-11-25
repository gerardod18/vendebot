/**
 * Regression tests for the review batch: tenant isolation of channel accounts, WhatsApp connect verification,
 * channel routing, inbox windows, bounded platform reads, delivery retries, automation edits and scoped queries.
 * Each test names the guard it proves.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { encryptSecret } from "../convex/lib/crypto";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
const KEY = Buffer.alloc(32, 5).toString("base64");
const HOUR = 3600_000;
const X = "1784000000"; // the contested channel account id
const PNID = "109876543210";
const GOOD = "EAAG-good-token".padEnd(40, "x");
const JUNK = "junk-token-not-valid".padEnd(40, "y");

type T = ReturnType<typeof convexTest>;

async function mkOrg(t: T, userId: string, name = userId) {
  return t.run(async (ctx) => {
    const orgId = await ctx.db.insert("orgs", { name, slug: name, createdBy: userId });
    await ctx.db.insert("members", { orgId, userId, role: "owner" });
    await ctx.db.insert("orgSettings", {
      orgId, plan: "free", aiModel: "claude-haiku-5-5", aiMonthlyQuota: 200, timezone: "UTC",
      businessHours: { days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59" }, defaultLanguage: "es",
    });
    return orgId;
  });
}

async function mkAccount(t: T, orgId: Id<"orgs">, igUserId: string, o: { channel?: "whatsapp"; status?: "active" | "expired" | "revoked"; token?: string } = {}) {
  const tokenEnc = await encryptSecret(o.token ?? "tok", KEY);
  return t.run((ctx) => ctx.db.insert("igAccounts", {
    orgId, igUserId, username: "acct", tokenEnc, tokenExpiresAt: Date.now() + 1e10, status: o.status ?? "active", webhookSubscribed: true,
    connectedBy: "u", ...(o.channel ? { channel: o.channel } : {}),
  }));
}

const ev = (id: string, igUserId: string, text: string, extra: Record<string, unknown> = {}) =>
  ({ type: "message" as const, dedupeKey: id, igUserId, senderId: "cust1", timestamp: Date.now(), text, ...extra });

async function receive(t: T, events: any[]) {
  const res = await t.mutation(internal.engine.ingest.ingestEvents, { events });
  for (const a of res.accepted) {
    await t.mutation(internal.engine.runner.processInbound, {
      event: a.event, conversationId: a.conversationId as any, contactId: a.contactId as any, igAccountId: a.igAccountId as any, isFirstContact: a.isFirstContact,
    });
  }
  return res;
}

async function settle(t: T, ms = 2000, rounds = 6) {
  for (let i = 0; i < rounds; i++) { vi.advanceTimersByTime(ms); await t.finishInProgressScheduledFunctions(); }
}

let calls: { url: string; auth: string | null; body: any }[] = [];
type Route = (url: string, init: any) => Response | undefined;
let route: Route | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
  calls = [];
  route = undefined;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
    calls.push({ url: String(url), auth: init?.headers?.Authorization ?? null, body: init?.body ? JSON.parse(init.body) : undefined });
    const custom = route?.(String(url), init);
    if (custom) return custom;
    if (String(url).includes("/messages")) return new Response(JSON.stringify({ message_id: `m${calls.length}`, messages: [{ id: `w${calls.length}` }] }), { status: 200 });
    return new Response("{}", { status: 200 });
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); delete process.env.TOKEN_ENCRYPTION_KEY; });

const sends = () => calls.filter((c) => c.url.includes("/messages"));
const keyword = (as: any, orgId: Id<"orgs">, igAccountId: Id<"igAccounts">, text: string, extra: Record<string, unknown> = {}): Promise<{ triggerId: Id<"triggers">; flowId: Id<"flows"> }> =>
  as.mutation(api.automations.create, { orgId, igAccountId, name: "precio", template: { key: "keywordReply", text }, keywords: ["precio"], ...extra });

describe("A1: a revoked account is never adopted by another workspace", () => {
  it("B connecting A's old account id gets a new row; A's customers, triggers and data stay with A", async () => {
    const t = convexTest(schema, modules);
    const orgA = await mkOrg(t, "alice"), orgB = await mkOrg(t, "bob");
    const alice = t.withIdentity({ subject: "alice" }), bob = t.withIdentity({ subject: "bob" });
    const accA = await mkAccount(t, orgA, X);
    const { triggerId: trigA } = await keyword(alice, orgA, accA, "Precio de A");
    await receive(t, [ev("a1", X, "hola")]);
    await settle(t);
    const aMessages = await t.run(async (ctx) => (await ctx.db.query("messages").collect()).length);

    await alice.mutation(api.accounts.disconnect, { orgId: orgA, accountId: accA });
    const accB = await t.mutation(internal.accounts.upsertAccount, {
      orgId: orgB, userId: "bob", igUserId: X, username: "b", tokenEnc: await encryptSecret("tok-b", KEY), tokenExpiresAt: Date.now() + 1e10,
    });
    expect(accB).not.toBe(accA);
    await t.run(async (ctx) => {
      expect(await ctx.db.get(accA)).toMatchObject({ orgId: orgA, status: "revoked", tokenEnc: "" });
      expect(await ctx.db.get(accB)).toMatchObject({ orgId: orgB, status: "active" });
    });
    await keyword(bob, orgB, accB, "Precio de B");

    // A returning customer of A writes to the account, which is now B's.
    const res = await receive(t, [ev("a2", X, "precio")]);
    await settle(t);
    expect(res.accepted).toHaveLength(1);
    expect(res.accepted[0].orgId).toBe(orgB);
    expect(sends().map((c) => c.body.message.text)).toEqual(["Precio de B"]);
    await t.run(async (ctx) => {
      expect((await ctx.db.get(trigA))!.firedCount).toBe(0); // A's trigger never fired
      const mine = (await ctx.db.query("messages").collect()).filter((m) => m.orgId === orgA);
      expect(mine).toHaveLength(aMessages); // nothing was added to A's conversations
      const contacts = await ctx.db.query("contacts").collect();
      expect(contacts.filter((c) => c.orgId === orgB)).toHaveLength(1);
      expect(contacts.filter((c) => c.orgId === orgA)).toHaveLength(1);
    });
    // each workspace sees only its own conversations and messages
    const listB = await bob.query(api.inbox.listConversations, { orgId: orgB });
    expect(listB).toHaveLength(1);
    const threadB = await bob.query(api.inbox.getThread, { orgId: orgB, conversationId: listB[0].conversationId });
    expect(threadB!.messages.map((m) => m.text)).not.toContain("hola");
    const listA = await alice.query(api.inbox.listConversations, { orgId: orgA });
    expect(listA).toHaveLength(1);
    expect(await bob.query(api.inbox.getThread, { orgId: orgB, conversationId: listA[0].conversationId })).toBeNull();
  });

  it("A cannot re-enable its trigger on the revoked account nor send through B's token", async () => {
    const t = convexTest(schema, modules);
    const orgA = await mkOrg(t, "alice"), orgB = await mkOrg(t, "bob");
    const alice = t.withIdentity({ subject: "alice" });
    const accA = await mkAccount(t, orgA, X);
    const { triggerId } = await keyword(alice, orgA, accA, "Precio de A");
    await receive(t, [ev("a1", X, "hola")]);
    const convA = (await alice.query(api.inbox.listConversations, { orgId: orgA }))[0].conversationId;
    await alice.mutation(api.accounts.disconnect, { orgId: orgA, accountId: accA });
    await mkAccount(t, orgB, X, { token: "TOKEN-OF-B" });

    await expect(alice.mutation(api.automations.setEnabled, { orgId: orgA, triggerId, enabled: true })).rejects.toThrow(/Reconecta/);
    await expect(alice.mutation(api.inbox.sendHuman, { orgId: orgA, conversationId: convA, text: "hola" })).rejects.toThrow(/disconnected/);
    // even a direct delivery for A's conversation sends nothing (the row is revoked and B's token is not reachable from it)
    await t.action(internal.outbound.deliver, { conversationId: convA, items: [{ text: "x" }], source: "bot" });
    expect(sends()).toHaveLength(0);
  });

  it("rows that drifted across workspaces (legacy adopted data) are inert: no routing, no delivery", async () => {
    const t = convexTest(schema, modules);
    const orgA = await mkOrg(t, "alice"), orgB = await mkOrg(t, "bob");
    const alice = t.withIdentity({ subject: "alice" });
    const acc = await mkAccount(t, orgA, X);
    const { triggerId } = await keyword(alice, orgA, acc, "Precio de A");
    await receive(t, [ev("a1", X, "hola")]);
    const convA = (await alice.query(api.inbox.listConversations, { orgId: orgA }))[0].conversationId;
    // legacy state: the account row was re-pointed to B while A's conversation, contact and trigger stayed behind
    await t.run((ctx) => ctx.db.patch(acc, { orgId: orgB }));
    expect(await t.query(internal.outbound.loadTarget, { conversationId: convA })).toBeNull();
    await receive(t, [ev("a2", X, "precio")]);
    await settle(t);
    expect(sends()).toHaveLength(0);
    await t.run(async (ctx) => { expect((await ctx.db.get(triggerId))!.firedCount).toBe(0); });
    await expect(alice.mutation(api.inbox.sendHuman, { orgId: orgA, conversationId: convA, text: "x" })).rejects.toThrow(/not found/);
    // even with a trigger of the account's NEW owner, A's leftover conversation and contact are never routed into
    const bobTrigger = (await keyword(t.withIdentity({ subject: "bob" }), orgB, acc, "Precio de B")).triggerId;
    await receive(t, [ev("a3", X, "precio")]);
    await settle(t);
    expect(sends()).toHaveLength(0);
    await t.run(async (ctx) => {
      expect((await ctx.db.get(bobTrigger))!.firedCount).toBe(0);
      expect(await ctx.db.query("flowRuns").collect()).toHaveLength(0);
    });
  });

  it("Meta's deauthorize callback revokes only the live Instagram row and leaves the former owner's row alone", async () => {
    const t = convexTest(schema, modules);
    const orgA = await mkOrg(t, "alice"), orgB = await mkOrg(t, "bob");
    const old = await mkAccount(t, orgA, X, { status: "revoked" });
    const live = await mkAccount(t, orgB, X);
    const wa = await mkAccount(t, orgB, X, { channel: "whatsapp" });
    await t.mutation(internal.privacy.revokeAccountByIgUserId, { igUserId: X }); // used to throw on two rows (.unique())
    await t.run(async (ctx) => {
      expect((await ctx.db.get(live))!.status).toBe("revoked");
      expect((await ctx.db.get(old))!.status).toBe("revoked");
      expect((await ctx.db.get(wa))!.status).toBe("active"); // a WhatsApp number with the same id is not an Instagram user
    });
  });
});

describe("A2: WhatsApp connect verifies first, and routing is per channel", () => {
  const creds = (orgId: Id<"orgs">, accessToken: string) => ({ orgId, phoneNumberId: PNID, wabaId: "123456789012", accessToken });
  const waRoute: Route = (url, init) => {
    if (url.includes(`/${PNID}?`) || url.endsWith(`/${PNID}`)) {
      return init.headers.Authorization === `Bearer ${GOOD}`
        ? new Response(JSON.stringify({ display_phone_number: "+1 555 000 1111", verified_name: "Tienda" }), { status: 200 })
        : new Response(JSON.stringify({ error: { code: 190, message: "Invalid OAuth access token" } }), { status: 401 });
    }
    return undefined;
  };

  it("a squat attempt with a junk token fails, leaves no row and does not block the real owner", async () => {
    const t = convexTest(schema, modules);
    route = waRoute;
    const evil = await mkOrg(t, "eve"), real = await mkOrg(t, "owner");
    await expect(t.withIdentity({ subject: "eve" }).action(api.accounts.connectWhatsApp, creds(evil, JUNK))).rejects.toThrow(/No pudimos verificar/);
    await t.run(async (ctx) => { expect(await ctx.db.query("igAccounts").collect()).toHaveLength(0); }); // no `expired` row owns the id
    const { accountId } = await t.withIdentity({ subject: "owner" }).action(api.accounts.connectWhatsApp, creds(real, GOOD));
    await settle(t);
    await t.run(async (ctx) => { expect(await ctx.db.get(accountId)).toMatchObject({ orgId: real, channel: "whatsapp", status: "active", username: "+1 555 000 1111", webhookSubscribed: true }); });
  });

  it("a conflict with another workspace gives one generic message that does not reveal where the account is", async () => {
    const t = convexTest(schema, modules);
    route = waRoute;
    const a = await mkOrg(t, "alice"), b = await mkOrg(t, "bob");
    await t.withIdentity({ subject: "alice" }).action(api.accounts.connectWhatsApp, creds(a, GOOD));
    const err = await t.withIdentity({ subject: "bob" }).action(api.accounts.connectWhatsApp, creds(b, GOOD)).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/No pudimos conectar/);
    expect((err as Error).message).not.toMatch(/workspace|espacio|otro|another|connected|conectad[ao] a/i);
    // the same text for the Instagram path
    await mkAccount(t, a, "ig-77");
    await expect(t.mutation(internal.accounts.upsertAccount, { orgId: b, userId: "bob", igUserId: "ig-77", username: "x", tokenEnc: "e", tokenExpiresAt: 1e15 }))
      .rejects.toThrow(/No pudimos conectar/);
  });

  it("only admins of the workspace can connect (the action checks membership)", async () => {
    const t = convexTest(schema, modules);
    route = waRoute;
    const a = await mkOrg(t, "alice");
    await expect(t.withIdentity({ subject: "mallory" }).action(api.accounts.connectWhatsApp, creds(a, GOOD))).rejects.toThrow(/Forbidden/);
    await expect(t.action(api.accounts.connectWhatsApp, creds(a, GOOD))).rejects.toThrow(/Not authenticated/);
    expect(calls).toHaveLength(0); // no Meta call before the membership check
  });

  it("an Instagram event is never routed to a WhatsApp account with the same id, and vice versa", async () => {
    const t = convexTest(schema, modules);
    const a = await mkOrg(t, "alice"), b = await mkOrg(t, "bob");
    const wa = await mkAccount(t, a, X, { channel: "whatsapp" });
    expect((await t.mutation(internal.engine.ingest.ingestEvents, { events: [ev("i1", X, "hola")] })).unknownAccount).toBe(1);
    const ig = await mkAccount(t, b, X);
    const r1 = await t.mutation(internal.engine.ingest.ingestEvents, { events: [ev("i2", X, "hola")] });
    expect(r1.accepted.map((x) => x.igAccountId)).toEqual([ig]);
    const r2 = await t.mutation(internal.engine.ingest.ingestEvents, { events: [ev("w1", X, "hola", { channel: "whatsapp" })] });
    expect(r2.accepted.map((x) => x.igAccountId)).toEqual([wa]);
    // a WhatsApp event with no live WhatsApp account is dropped even though an Instagram account has that id
    await t.run((ctx) => ctx.db.patch(wa, { status: "revoked" }));
    expect((await t.mutation(internal.engine.ingest.ingestEvents, { events: [ev("w2", X, "hola", { channel: "whatsapp" })] })).unknownAccount).toBe(1);
  });

  it("only an `active` account receives events (an expired row owns nothing)", async () => {
    const t = convexTest(schema, modules);
    const a = await mkOrg(t, "alice");
    await mkAccount(t, a, X, { status: "expired" });
    expect((await t.mutation(internal.engine.ingest.ingestEvents, { events: [ev("e1", X, "hola")] })).unknownAccount).toBe(1);
  });
});

describe("A3: tokens never travel through scheduler arguments", () => {
  it("subscribeWebhooks takes only the account id and decrypts the token inside the action", async () => {
    const t = convexTest(schema, modules);
    const a = await mkOrg(t, "alice");
    const acc = await mkAccount(t, a, X, { token: "SECRET-IG-TOKEN" });
    await t.run((ctx) => ctx.db.patch(acc, { webhookSubscribed: false }));
    await expect(t.action(internal.accounts.subscribeWebhooks, { accountId: acc, token: "SECRET-IG-TOKEN" } as any)).rejects.toThrow();
    await t.action(internal.accounts.subscribeWebhooks, { accountId: acc });
    expect(calls.find((c) => c.url.includes("/subscribed_apps"))?.auth).toBe("Bearer SECRET-IG-TOKEN");
    await t.run(async (ctx) => { expect((await ctx.db.get(acc))!.webhookSubscribed).toBe(true); });
  });

  it("the OAuth callback schedules the subscription without the plaintext token", async () => {
    const t = convexTest(schema, modules);
    Object.assign(process.env, { META_APP_ID: "1", META_APP_SECRET: "s", CONVEX_SITE_URL: "https://x.convex.site", SITE_URL: "https://app.test" });
    try {
      route = (url) => {
        if (url.includes("/oauth/access_token")) return new Response(JSON.stringify({ access_token: "PLAINTEXT-OAUTH-TOKEN" }), { status: 200 });
        if (url.includes("assigned_instagram_accounts")) return new Response(JSON.stringify({ data: [{ id: X, username: "tienda" }] }), { status: 200 });
        return undefined;
      };
      const orgId = await mkOrg(t, "alice");
      await t.run((ctx) => ctx.db.insert("oauthStates", { orgId, userId: "alice", state: "st", expiresAt: Date.now() + 60_000 }));
      const res = await t.fetch("/meta/oauth/callback?code=c&state=st");
      expect(res.status).toBe(302);
      const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
      const sub = scheduled.filter((s) => s.name.includes("subscribeWebhooks"));
      expect(sub).toHaveLength(1);
      expect(JSON.stringify(scheduled.map((s) => s.args))).not.toContain("PLAINTEXT-OAUTH-TOKEN");
      expect(JSON.stringify(sub[0].args)).toContain("accountId");
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally {
      for (const k of ["META_APP_ID", "META_APP_SECRET", "CONVEX_SITE_URL", "SITE_URL"]) delete process.env[k];
    }
  });
});

describe("B2: verifyWhatsApp is safe against races and transient errors", () => {
  const verify = async (t: T, acc: Id<"igAccounts">) => { await t.action(internal.accounts.verifyWhatsApp, { accountId: acc }); };
  const status = (t: T, acc: Id<"igAccounts">) => t.run(async (ctx) => (await ctx.db.get(acc))!);

  it("never overwrites `revoked` with `expired`", async () => {
    const t = convexTest(schema, modules);
    const a = await mkOrg(t, "alice");
    const acc = await mkAccount(t, a, PNID, { channel: "whatsapp", status: "revoked" });
    route = () => new Response(JSON.stringify({ error: { code: 190, message: "bad" } }), { status: 401 });
    await verify(t, acc);
    expect((await status(t, acc)).status).toBe("revoked");
    expect(calls).toHaveLength(0); // an inactive account is not even checked
  });

  it("marks expired only on auth errors; 5xx/429/network keep it active and retry later", async () => {
    const t = convexTest(schema, modules);
    const a = await mkOrg(t, "alice");
    const acc = await mkAccount(t, a, PNID, { channel: "whatsapp" });
    for (const res of [new Response("{}", { status: 503 }), new Response(JSON.stringify({ error: { code: 4 } }), { status: 429 })]) {
      route = () => res.clone();
      await verify(t, acc);
      expect((await status(t, acc)).status).toBe("active");
    }
    route = () => { throw new TypeError("network down"); };
    await verify(t, acc);
    expect((await status(t, acc)).status).toBe("active");
    const pending = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(pending.filter((s) => s.name.includes("verifyWhatsApp")).length).toBeGreaterThanOrEqual(3); // retries queued
    route = () => new Response(JSON.stringify({ error: { code: 190, message: "expired" } }), { status: 401 });
    await verify(t, acc);
    expect((await status(t, acc)).status).toBe("expired");
  });

  it("background status changes only ever apply to an active row (a job that raced with a disconnect)", async () => {
    const t = convexTest(schema, modules);
    const a = await mkOrg(t, "alice");
    const acc = await mkAccount(t, a, PNID, { channel: "whatsapp", status: "revoked" });
    await t.run((ctx) => ctx.db.patch(acc, { webhookSubscribed: false }));
    await t.mutation(internal.accounts.markExpired, { accountId: acc });
    await t.mutation(internal.outbound.markAccountExpired, { accountId: acc });
    await t.mutation(internal.accounts.markSubscribed, { accountId: acc, subscribed: true });
    await t.mutation(internal.accounts.setDisplay, { accountId: acc, username: "changed" });
    expect(await status(t, acc)).toMatchObject({ status: "revoked", webhookSubscribed: false, username: "acct" });
  });

  it("an undecryptable token does not crash the action", async () => {
    const t = convexTest(schema, modules);
    const a = await mkOrg(t, "alice");
    const acc = await mkAccount(t, a, PNID, { channel: "whatsapp" });
    await t.run((ctx) => ctx.db.patch(acc, { tokenEnc: "not-a-valid-ciphertext" }));
    await expect(verify(t, acc)).resolves.toBeUndefined();
    expect((await status(t, acc)).status).toBe("active");
  });

  it("reconnecting with a bad token does not replace a working token", async () => {
    const t = convexTest(schema, modules);
    const a = await mkOrg(t, "alice");
    const acc = await mkAccount(t, a, PNID, { channel: "whatsapp" });
    const before = (await status(t, acc)).tokenEnc;
    route = () => new Response(JSON.stringify({ error: { code: 190, message: "bad" } }), { status: 401 });
    await expect(t.withIdentity({ subject: "alice" }).action(api.accounts.connectWhatsApp, { orgId: a, phoneNumberId: PNID, wabaId: "123456789012", accessToken: JUNK })).rejects.toThrow(/No pudimos verificar/);
    expect(await status(t, acc)).toMatchObject({ tokenEnc: before, status: "active" });
  });
});

describe("A7: the inbox uses the same reply window as outbound", () => {
  async function conv(t: T, orgId: Id<"orgs">, channel: "whatsapp" | undefined, ageHours: number) {
    const acc = await mkAccount(t, orgId, channel ? PNID : X, { channel });
    return t.run(async (ctx) => {
      const contactId = await ctx.db.insert("contacts", { orgId, igAccountId: acc, igsid: "c1", tags: [], fields: {}, lastInboundAt: Date.now() - ageHours * HOUR, firstSeenAt: 1 });
      return ctx.db.insert("conversations", { orgId, igAccountId: acc, contactId, mode: "bot", lastMessageAt: 1, unread: 0 });
    });
  }

  it("WhatsApp: 24h only, no HUMAN_AGENT extension; Instagram: 24h, then 7 days", async () => {
    const t = convexTest(schema, modules);
    const orgId = await mkOrg(t, "alice");
    const alice = t.withIdentity({ subject: "alice" });
    const wa25 = await conv(t, orgId, "whatsapp", 25), ig25 = await conv(t, orgId, undefined, 25);
    expect(await alice.query(api.inbox.getThread, { orgId, conversationId: wa25 })).toMatchObject({ channel: "whatsapp", canReply: false });
    expect(await alice.query(api.inbox.getThread, { orgId, conversationId: ig25 })).toMatchObject({ channel: "instagram", canReply: true });
    await expect(alice.mutation(api.inbox.sendHuman, { orgId, conversationId: wa25, text: "hola" })).rejects.toThrow(/24-hour/);
    await alice.mutation(api.inbox.sendHuman, { orgId, conversationId: ig25, text: "hola" }); // HUMAN_AGENT window
    const wa23 = await conv(t, orgId, "whatsapp", 23);
    expect(await alice.query(api.inbox.getThread, { orgId, conversationId: wa23 })).toMatchObject({ canReply: true });
    const ig8d = await conv(t, orgId, undefined, 8 * 24);
    expect(await alice.query(api.inbox.getThread, { orgId, conversationId: ig8d })).toMatchObject({ canReply: false });
    await expect(alice.mutation(api.inbox.sendHuman, { orgId, conversationId: ig8d, text: "x" })).rejects.toThrow(/7-day/);
  });
});

describe("A8: platform.overview is bounded", () => {
  it("returns at most 50 workspaces, capped counts and flags", async () => {
    process.env.SUPERADMIN_EMAILS = "root@x.com";
    try {
      const t = convexTest(schema, modules);
      const root = t.withIdentity({ subject: "root", email: "root@x.com" });
      await root.mutation(api.platform.claim, {});
      const big = await t.run(async (ctx) => {
        const orgId = await ctx.db.insert("orgs", { name: "big", slug: "big", createdBy: "u" });
        for (let i = 0; i < 101; i++) await ctx.db.insert("members", { orgId, userId: `m${i}`, role: "agent" });
        return orgId;
      });
      const small = await mkOrg(t, "solo", "small");
      const r1 = await root.query(api.platform.overview, {});
      expect(r1.capped).toBe(false);
      expect(r1.orgs.find((o: any) => o.orgId === big)).toMatchObject({ members: 100, capped: { members: true } });
      expect(r1.orgs.find((o: any) => o.orgId === small)).toMatchObject({ members: 1, capped: { members: false } });
      await t.run(async (ctx) => { for (let i = 0; i < 55; i++) await ctx.db.insert("orgs", { name: `o${i}`, slug: `o${i}`, createdBy: "u" }); });
      const r2 = await root.query(api.platform.overview, {});
      expect(r2.orgs).toHaveLength(50);
      expect(r2.capped).toBe(true);
      expect(r2.orgs[0].name).toBe("o54"); // the latest ones
    } finally { delete process.env.SUPERADMIN_EMAILS; }
  });
});

describe("B1: delivery bookkeeping and retries", () => {
  async function setup() {
    const t = convexTest(schema, modules);
    const orgId = await mkOrg(t, "alice");
    const acc = await mkAccount(t, orgId, X);
    const alice = t.withIdentity({ subject: "alice" });
    await keyword(alice, orgId, acc, "Cuesta $10");
    return { t, alice, orgId };
  }

  it("a failure while recording a message that WAS sent does not mark it failed or fail the run", async () => {
    const { t } = await setup();
    // a numeric message id makes recordMessage reject its arguments after the send succeeded
    route = (url) => (url.includes("/messages") ? new Response(JSON.stringify({ message_id: 12345 }), { status: 200 }) : undefined);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await receive(t, [ev("m1", X, "precio")]);
    await settle(t);
    expect(sends()).toHaveLength(1);
    await t.run(async (ctx) => {
      expect((await ctx.db.query("flowRuns").collect())[0].status).toBe("done");
      expect((await ctx.db.query("messages").collect()).filter((m) => m.status === "failed")).toHaveLength(0);
    });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("retries a retryable error with backoff and sends once", async () => {
    const { t } = await setup();
    let n = 0;
    route = (url) => (url.includes("/messages") && n++ === 0 ? new Response(JSON.stringify({ error: { code: 4, message: "rate limit" } }), { status: 429 }) : undefined);
    await receive(t, [ev("m1", X, "precio")]);
    await settle(t);
    expect(sends()).toHaveLength(1); // failed attempt, retry still waiting
    await settle(t, 31_000, 2);
    expect(sends()).toHaveLength(2);
    await t.run(async (ctx) => {
      const out = (await ctx.db.query("messages").collect()).filter((m) => m.direction === "out");
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ status: "sent", text: "Cuesta $10" });
      expect((await ctx.db.query("flowRuns").collect())[0].status).toBe("done");
    });
  });

  it("a takeover during the backoff cancels the pending retry", async () => {
    const { t, alice, orgId } = await setup();
    route = (url) => (url.includes("/messages") ? new Response(JSON.stringify({ error: { code: 4, message: "rate limit" } }), { status: 429 }) : undefined);
    await receive(t, [ev("m1", X, "precio")]);
    await settle(t);
    expect(sends()).toHaveLength(1);
    const conversationId = (await alice.query(api.inbox.listConversations, { orgId }))[0].conversationId;
    await alice.mutation(api.inbox.takeOver, { orgId, conversationId });
    route = undefined; // the network would now succeed
    await settle(t, 31_000, 3);
    expect(sends()).toHaveLength(1); // the retry did not fire
    await t.run(async (ctx) => { expect((await ctx.db.query("messages").collect()).filter((m) => m.direction === "out")).toHaveLength(0); });
  });
});

describe("B3: channel compatibility", () => {
  it("rejects comment/story triggers and >10 options on WhatsApp, allows them on Instagram", async () => {
    const t = convexTest(schema, modules);
    const orgId = await mkOrg(t, "alice");
    const alice = t.withIdentity({ subject: "alice" });
    const wa = await mkAccount(t, orgId, PNID, { channel: "whatsapp" }), ig = await mkAccount(t, orgId, X);
    for (const key of ["commentToDm", "storyMention"] as const) {
      await expect(alice.mutation(api.automations.create, { orgId, igAccountId: wa, name: "x", template: { key, text: "hola" }, keywords: ["a"] })).rejects.toThrow(/solo existen en Instagram/);
    }
    await alice.mutation(api.automations.create, { orgId, igAccountId: ig, name: "x", template: { key: "commentToDm", text: "hola" }, keywords: ["a"] });

    const mk = (n: number) => ({
      startNodeId: "q",
      nodes: [{ id: "q", type: "quickReplies", text: "elige", options: Array.from({ length: n }, (_, i) => ({ title: `o${i}`, payload: `p${i}` })) }],
      edges: [],
    });
    const waTrig = (await alice.mutation(api.automations.create, { orgId, igAccountId: wa, name: "wa", template: { key: "keywordReply", text: "hi" }, keywords: ["a"] })).triggerId;
    const igTrig = (await alice.mutation(api.automations.create, { orgId, igAccountId: ig, name: "ig", template: { key: "keywordReply", text: "hi" }, keywords: ["b"] })).triggerId;
    await expect(alice.mutation(api.automations.saveGraph, { orgId, triggerId: waTrig, graph: mk(11) })).rejects.toThrow(/máximo 10 opciones/);
    await alice.mutation(api.automations.saveGraph, { orgId, triggerId: waTrig, graph: mk(10) });
    await alice.mutation(api.automations.saveGraph, { orgId, triggerId: igTrig, graph: mk(11) }); // Instagram allows up to 13
    // the template form path applies the same check (quick replies in a keyword reply)
    const many = Array.from({ length: 11 }, (_, i) => ({ title: `o${i}`, payload: `p${i}` }));
    await expect(alice.mutation(api.automations.create, { orgId, igAccountId: wa, name: "y", template: { key: "keywordReply", text: "hi", quickReplies: many }, keywords: ["c"] })).rejects.toThrow();
  });
});

describe("B5: stale edits are refused", () => {
  it("saveGraph and update fail when the active version moved on", async () => {
    const t = convexTest(schema, modules);
    const orgId = await mkOrg(t, "alice");
    const alice = t.withIdentity({ subject: "alice" });
    const acc = await mkAccount(t, orgId, X);
    const { triggerId } = await keyword(alice, orgId, acc, "v1");
    const graph = { startNodeId: "m", nodes: [{ id: "m", type: "message", text: "v2" }], edges: [] };
    expect(await alice.mutation(api.automations.saveGraph, { orgId, triggerId, graph, expectedVersion: 1 })).toEqual({ version: 2 });
    await expect(alice.mutation(api.automations.saveGraph, { orgId, triggerId, graph, expectedVersion: 1 })).rejects.toThrow(/cambió/);
    await expect(alice.mutation(api.automations.update, { orgId, triggerId, name: "x", template: { key: "keywordReply", text: "z" }, keywords: ["a"], expectedVersion: 1 })).rejects.toThrow(/cambió|edited in the flow editor/);
    expect((await alice.query(api.automations.get, { orgId, triggerId }))!.version).toBe(2);
    expect(await alice.mutation(api.automations.saveGraph, { orgId, triggerId, graph, expectedVersion: 2 })).toEqual({ version: 3 });
  });

  it("update from the form refuses a stale version and accepts the current one", async () => {
    const t = convexTest(schema, modules);
    const orgId = await mkOrg(t, "alice");
    const alice = t.withIdentity({ subject: "alice" });
    const acc = await mkAccount(t, orgId, X);
    const { triggerId } = await keyword(alice, orgId, acc, "v1");
    const args = { orgId, triggerId, name: "x", template: { key: "keywordReply", text: "v2" }, keywords: ["a"] };
    await alice.mutation(api.automations.update, { ...args, expectedVersion: 1 });
    await expect(alice.mutation(api.automations.update, { ...args, expectedVersion: 1 })).rejects.toThrow(/cambió/);
    await alice.mutation(api.automations.update, { ...args, expectedVersion: 2 });
  });
});

describe("B6: deleting an automation cancels its waiting runs", () => {
  it("a run waiting on a timer is cancelled and sends nothing afterwards", async () => {
    const t = convexTest(schema, modules);
    const orgId = await mkOrg(t, "alice");
    const alice = t.withIdentity({ subject: "alice" });
    const acc = await mkAccount(t, orgId, X);
    const { triggerId, flowId } = await keyword(alice, orgId, acc, "v1");
    const graph = {
      startNodeId: "a",
      nodes: [{ id: "a", type: "message", text: "primero" }, { id: "w", type: "wait", minutes: 10 }, { id: "b", type: "message", text: "seguimiento" }],
      edges: [{ from: "a", port: "next", to: "w" }, { from: "w", port: "next", to: "b" }],
    };
    await alice.mutation(api.automations.saveGraph, { orgId, triggerId, graph });
    await receive(t, [ev("m1", X, "precio")]);
    await settle(t);
    expect(sends().map((c) => c.body.message.text)).toEqual(["primero"]);
    await t.run(async (ctx) => { expect((await ctx.db.query("flowRuns").collect())[0]).toMatchObject({ status: "waiting", waitingFor: "timer" }); });
    await alice.mutation(api.automations.remove, { orgId, triggerId });
    await t.run(async (ctx) => {
      expect((await ctx.db.query("flowRuns").collect())[0]).toMatchObject({ status: "cancelled" });
      expect((await ctx.db.get(flowId))!.archived).toBe(true);
    });
    await settle(t, 11 * 60_000, 2);
    expect(sends().map((c) => c.body.message.text)).toEqual(["primero"]); // the follow-up never goes out
  });
});

describe("B11: org filter before the limit", () => {
  it("listConversations(mode) is not emptied by newer conversations of the other mode", async () => {
    const t = convexTest(schema, modules);
    const orgId = await mkOrg(t, "alice");
    const acc = await mkAccount(t, orgId, X);
    await t.run(async (ctx) => {
      const mk = async (i: number, mode: "bot" | "human", at: number) => {
        const contactId = await ctx.db.insert("contacts", { orgId, igAccountId: acc, igsid: `c${i}`, tags: [], fields: {}, firstSeenAt: 1 });
        await ctx.db.insert("conversations", { orgId, igAccountId: acc, contactId, mode, lastMessageAt: at, unread: 0 });
      };
      await mk(0, "human", 1);
      for (let i = 1; i <= 120; i++) await mk(i, "bot", 1000 + i);
    });
    const alice = t.withIdentity({ subject: "alice" });
    expect(await alice.query(api.inbox.listConversations, { orgId, mode: "human" })).toHaveLength(1);
    expect(await alice.query(api.inbox.listConversations, { orgId })).toHaveLength(100);
  });

  it("failedEvents and failedRuns are not pushed out by other tenants or by newer healthy rows", async () => {
    const t = convexTest(schema, modules);
    const quiet = await mkOrg(t, "alice", "quiet"), noisy = await mkOrg(t, "bob", "noisy");
    const acc = await mkAccount(t, quiet, X);
    await t.run(async (ctx) => {
      await ctx.db.insert("webhookEvents", { dedupeKey: "old", orgId: quiet, type: "message", raw: {}, receivedAt: 1, error: "flow_unavailable" });
      for (let i = 0; i < 350; i++) await ctx.db.insert("webhookEvents", { dedupeKey: `n${i}`, orgId: noisy, type: "message", raw: {}, receivedAt: 1000 + i, error: "x" });
      const contactId = await ctx.db.insert("contacts", { orgId: quiet, igAccountId: acc, igsid: "c", tags: [], fields: {}, firstSeenAt: 1 });
      const conversationId = await ctx.db.insert("conversations", { orgId: quiet, igAccountId: acc, contactId, mode: "bot", lastMessageAt: 1, unread: 0 });
      const flowId = await ctx.db.insert("flows", { orgId: quiet, name: "f", archived: false });
      const flowVersionId = await ctx.db.insert("flowVersions", { orgId: quiet, flowId, version: 1, graph: {}, createdBy: "u" });
      const base = { orgId: quiet, flowVersionId, contactId, conversationId, vars: {} };
      await ctx.db.insert("flowRuns", { ...base, status: "failed", error: "window_closed" });
      for (let i = 0; i < 310; i++) await ctx.db.insert("flowRuns", { ...base, status: "done" });
    });
    const alice = t.withIdentity({ subject: "alice" });
    expect((await alice.query(api.admin.failedEvents, { orgId: quiet })).map((e) => e.error)).toEqual(["flow_unavailable"]);
    expect((await alice.query(api.admin.failedRuns, { orgId: quiet })).map((r) => r.error)).toEqual(["window_closed"]);
  });
});

describe("A6: deliverAi re-checks the run at the moment of sending", () => {
  it("queues nothing when the run was cancelled or the conversation is human", async () => {
    const t = convexTest(schema, modules);
    const orgId = await mkOrg(t, "alice");
    const acc = await mkAccount(t, orgId, X);
    const ids = await t.run(async (ctx) => {
      const contactId = await ctx.db.insert("contacts", { orgId, igAccountId: acc, igsid: "c", tags: [], fields: {}, firstSeenAt: 1, lastInboundAt: Date.now() });
      const conversationId = await ctx.db.insert("conversations", { orgId, igAccountId: acc, contactId, mode: "bot", lastMessageAt: 1, unread: 0 });
      const flowId = await ctx.db.insert("flows", { orgId, name: "f", archived: false });
      const flowVersionId = await ctx.db.insert("flowVersions", { orgId, flowId, version: 1, graph: {}, createdBy: "u" });
      const mk = (status: "waiting" | "cancelled") => ctx.db.insert("flowRuns", { orgId, flowVersionId, contactId, conversationId, status, ...(status === "waiting" ? { waitingFor: "ai" as const } : {}), vars: {} });
      return { conversationId, live: await mk("waiting"), cancelled: await mk("cancelled") };
    });
    const queued = () => t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).filter((s) => s.name.includes("deliver")).length);
    await t.mutation(internal.ai.agent.deliverAi, { runId: ids.cancelled, text: "late" });
    expect(await queued()).toBe(0);
    await t.run((ctx) => ctx.db.patch(ids.conversationId, { mode: "human" }));
    await t.mutation(internal.ai.agent.deliverAi, { runId: ids.live, text: "late" });
    expect(await queued()).toBe(0);
    await t.run((ctx) => ctx.db.patch(ids.conversationId, { mode: "bot" }));
    await t.mutation(internal.ai.agent.deliverAi, { runId: ids.live, text: "on time" });
    expect(await queued()).toBe(1);
  });
});
