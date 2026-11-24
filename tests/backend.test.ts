import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { parseSignedRequest } from "../convex/instagram/signedRequest";
import { isSafeWebhookUrl } from "../convex/lib/safeUrl";
import { parseWebhook } from "../convex/instagram/parse";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
const as = (t: any, id: string) => t.withIdentity({ subject: id });

async function org(t: any, user = "u1") {
  return as(t, user).mutation(api.orgs.create, { name: "Tienda Ana" });
}
async function account(t: any, orgId: any, igUserId = "17840") {
  return t.run((ctx: any) => ctx.db.insert("igAccounts", { orgId, igUserId, username: "tienda", tokenEnc: "x", tokenExpiresAt: Date.now() + 1e10, status: "active", webhookSubscribed: true, connectedBy: "u1" }));
}

describe("pure helpers", () => {
  it("SSRF guard", () => {
    expect(isSafeWebhookUrl("https://hooks.example.com/x")).toBe(true);
    for (const u of ["http://example.com", "https://localhost/x", "https://127.0.0.1", "https://10.0.0.5", "https://192.168.1.1", "https://172.20.0.1", "https://169.254.169.254/latest", "https://[::1]/", "https://svc.internal/", "ftp://x.com", "nope"]) {
      expect(isSafeWebhookUrl(u), u).toBe(false);
    }
  });
  it("signed_request verifies the HMAC", async () => {
    const secret = "shh";
    const payload = btoa(JSON.stringify({ user_id: "42" })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
    const sigB64 = btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(await parseSignedRequest(`${sigB64}.${payload}`, secret)).toMatchObject({ user_id: "42" });
    expect(await parseSignedRequest(`${sigB64}.${payload}`, "wrong")).toBeNull();
    expect(await parseSignedRequest("garbage", secret)).toBeNull();
  });
});

describe("accounts + OAuth state", () => {
  beforeEach(() => { process.env.META_APP_ID = "123"; process.env.META_CONFIG_ID = "cfg1"; process.env.CONVEX_SITE_URL = "https://x.convex.site"; });
  afterEach(() => { delete process.env.META_APP_ID; delete process.env.META_CONFIG_ID; });

  it("startConnect needs admin and creates a one-time state", async () => {
    const t = convexTest(schema, modules);
    const orgId = await org(t);
    const { url } = await as(t, "u1").mutation(api.accounts.startConnect, { orgId });
    expect(new URL(url).searchParams.get("config_id")).toBe("cfg1");
    const state = new URL(url).searchParams.get("state")!;
    expect(await t.mutation(internal.accounts.consumeState, { state })).toMatchObject({ orgId, userId: "u1" });
    expect(await t.mutation(internal.accounts.consumeState, { state })).toBeNull(); // single use
    await expect(as(t, "mallory").mutation(api.accounts.startConnect, { orgId })).rejects.toThrow(/Forbidden/);
  });

  it("an Instagram account can't be stolen by another workspace; disconnect disables triggers; list hides tokens", async () => {
    const t = convexTest(schema, modules);
    const a = await org(t, "u1"), b = await org(t, "u2");
    const args = { userId: "u1", igUserId: "77", username: "x", tokenEnc: "enc", tokenExpiresAt: Date.now() + 1e10 };
    const id = await t.mutation(internal.accounts.upsertAccount, { orgId: a, ...args });
    await expect(t.mutation(internal.accounts.upsertAccount, { orgId: b, ...args })).rejects.toThrow(/another workspace/);
    const list = await as(t, "u1").query(api.accounts.list, { orgId: a });
    expect(list[0]).not.toHaveProperty("tokenEnc");
    await as(t, "u1").mutation(api.accounts.disconnect, { orgId: a, accountId: id });
    // now free to be connected by someone else
    await t.mutation(internal.accounts.upsertAccount, { orgId: b, ...args });
    await expect(as(t, "u1").mutation(api.accounts.disconnect, { orgId: a, accountId: id })).rejects.toThrow(/not found/);
  });
});

describe("inbox", () => {
  const seedConv = async (t: any, orgId: any, lastInboundAt = Date.now()) =>
    t.run(async (ctx: any) => {
      const igAccountId = await ctx.db.insert("igAccounts", { orgId, igUserId: "1", username: "t", tokenEnc: "x", tokenExpiresAt: 1e15, status: "active", webhookSubscribed: true, connectedBy: "u1" });
      const contactId = await ctx.db.insert("contacts", { orgId, igAccountId, igsid: "c1", tags: [], fields: {}, lastInboundAt, firstSeenAt: 1, name: "Ana" });
      return ctx.db.insert("conversations", { orgId, igAccountId, contactId, mode: "bot", lastMessageAt: 1, unread: 2 });
    });

  it("lists, takes over (cancelling runs), gives back, and isolates tenants", async () => {
    const t = convexTest(schema, modules);
    const orgId = await org(t, "u1"); const other = await org(t, "u2");
    const conversationId = await seedConv(t, orgId);
    expect((await as(t, "u1").query(api.inbox.listConversations, { orgId }))[0]).toMatchObject({ contactName: "Ana", unread: 2 });
    await as(t, "u1").mutation(api.inbox.markRead, { orgId, conversationId });
    await as(t, "u1").mutation(api.inbox.takeOver, { orgId, conversationId });
    expect((await as(t, "u1").query(api.inbox.getThread, { orgId, conversationId })).conversation).toMatchObject({ mode: "human", assignedTo: "u1" });
    await as(t, "u1").mutation(api.inbox.giveBack, { orgId, conversationId });
    // cross-tenant: u2 using its own org id with u1's conversation id
    await expect(as(t, "u2").query(api.inbox.getThread, { orgId: other, conversationId })).rejects.toThrow(/not found/);
    await expect(as(t, "u2").mutation(api.inbox.sendHuman, { orgId: other, conversationId, text: "hi" })).rejects.toThrow(/not found/);
  });

  it("sendHuman refuses after 7 days and otherwise switches to human mode", async () => {
    const t = convexTest(schema, modules);
    const orgId = await org(t);
    const old = await seedConv(t, orgId, Date.now() - 8 * 24 * 3600_000);
    await expect(as(t, "u1").mutation(api.inbox.sendHuman, { orgId, conversationId: old, text: "hola" })).rejects.toThrow(/window/);
    const ok = await seedConv(t, orgId);
    vi.useFakeTimers();
    await as(t, "u1").mutation(api.inbox.sendHuman, { orgId, conversationId: ok, text: "hola" });
    vi.useRealTimers();
    expect((await as(t, "u1").query(api.inbox.getThread, { orgId, conversationId: ok })).conversation.mode).toBe("human");
  });
});

describe("knowledge, usage, settings, invites", () => {
  it("knowledge CRUD is admin-only and tenant scoped", async () => {
    const t = convexTest(schema, modules);
    const orgId = await org(t, "u1"); const other = await org(t, "u2");
    const id = await as(t, "u1").mutation(api.knowledge.save, { orgId, title: "Envíos", content: "Gratis" });
    expect(await as(t, "u1").query(api.knowledge.list, { orgId })).toHaveLength(1);
    expect(await as(t, "u2").query(api.knowledge.list, { orgId: other })).toHaveLength(0);
    await expect(as(t, "u2").mutation(api.knowledge.remove, { orgId: other, id })).rejects.toThrow(/not found/);
    await expect(as(t, "u1").mutation(api.knowledge.save, { orgId, title: "", content: "x" })).rejects.toThrow();
  });

  it("settings validate input; usage summary reflects the plan", async () => {
    const t = convexTest(schema, modules);
    const orgId = await org(t);
    await as(t, "u1").mutation(api.orgs.updateSettings, { orgId, timezone: "America/Bogota", businessHours: { days: [1, 2], start: "09:00", end: "18:00" }, aiInstructions: "Sell shoes" });
    await expect(as(t, "u1").mutation(api.orgs.updateSettings, { orgId, timezone: "Nope/Zone" })).rejects.toThrow(/timezone/);
    await expect(as(t, "u1").mutation(api.orgs.updateSettings, { orgId, businessHours: { days: [9], start: "09:00", end: "18:00" } })).rejects.toThrow();
    expect(await as(t, "u1").query(api.orgs.getSettings, { orgId })).toMatchObject({ timezone: "America/Bogota", aiInstructions: "Sell shoes" });
    await t.mutation(internal.billing.applyPlan, { orgId, plan: "pro" });
    expect(await as(t, "u1").query(api.usage.summary, { orgId })).toMatchObject({ plan: "pro", aiMonthlyQuota: 10000, unlimited: false });
    await expect(t.mutation(internal.billing.applyPlan, { orgId, plan: "platinum" })).rejects.toThrow(/Unknown plan/);
  });

  it("invites: admin creates, invitee accepts once, token expires/single use", async () => {
    const t = convexTest(schema, modules);
    const orgId = await org(t, "owner");
    const { token } = await as(t, "owner").mutation(api.orgs.invite, { orgId, email: "Bob@Example.com", role: "agent" });
    expect(await as(t, "owner").query(api.orgs.listInvites, { orgId })).toHaveLength(1);
    await expect(as(t, "owner").mutation(api.orgs.invite, { orgId, email: "x@y.co", role: "owner" })).rejects.toThrow();
    expect(await as(t, "bob").mutation(api.orgs.acceptInvite, { token })).toBe(orgId);
    await expect(as(t, "carol").mutation(api.orgs.acceptInvite, { token })).rejects.toThrow(/invalid/);
    // agent role can read but not manage
    expect(await as(t, "bob").query(api.orgs.listMembers, { orgId })).toHaveLength(2);
    await expect(as(t, "bob").mutation(api.orgs.invite, { orgId, email: "z@z.co", role: "agent" })).rejects.toThrow(/Forbidden/);
    await as(t, "owner").mutation(api.orgs.removeMember, { orgId, memberUserId: "bob" });
    await expect(as(t, "owner").mutation(api.orgs.removeMember, { orgId, memberUserId: "owner" })).rejects.toThrow(/owner/);
  });
});

describe("privacy + retention", () => {
  const dm = (mid: string) => parseWebhook({ object: "instagram", entry: [{ id: "17840", time: 1, messaging: [
    { sender: { id: "victim" }, recipient: { id: "17840" }, timestamp: Date.now(), message: { mid, text: "hola" } }] }] });

  it("deletion callback removes the user's contacts, messages and raw events", async () => {
    const t = convexTest(schema, modules);
    const orgId = await org(t); await account(t, orgId);
    await t.mutation(internal.engine.ingest.ingestEvents, { events: dm("m1") });
    await t.mutation(internal.privacy.deleteSubjectData, { subjectId: "victim", code: "abc" });
    await t.run(async (ctx: any) => {
      for (const table of ["contacts", "conversations", "messages", "webhookEvents"]) expect(await ctx.db.query(table).collect(), table).toHaveLength(0);
    });
    expect(await t.query(api.privacy.deletionStatus, { code: "abc" })).toMatchObject({ status: "completed", deletedContacts: 1 });
    await t.mutation(internal.privacy.deleteSubjectData, { subjectId: "nobody", code: "def" });
    expect(await t.query(api.privacy.deletionStatus, { code: "def" })).toMatchObject({ status: "nothing_found" });
  });

  it("deauthorize revokes the account and disables its triggers; retention deletes old events", async () => {
    const t = convexTest(schema, modules);
    const orgId = await org(t); const accountId = await account(t, orgId);
    await t.mutation(internal.privacy.revokeAccountByIgUserId, { igUserId: "17840" });
    await t.run(async (ctx: any) => { expect((await ctx.db.get(accountId)).status).toBe("revoked"); });
    await t.run(async (ctx: any) => {
      await ctx.db.insert("webhookEvents", { dedupeKey: "old", type: "message", raw: {}, receivedAt: Date.now() - 40 * 24 * 3600_000 });
      await ctx.db.insert("webhookEvents", { dedupeKey: "new", type: "message", raw: {}, receivedAt: Date.now() });
    });
    expect(await t.mutation(internal.admin.retentionCleanup, {})).toMatchObject({ events: 1, more: false });
    await t.run(async (ctx: any) => { expect((await ctx.db.query("webhookEvents").collect()).map((e: any) => e.dedupeKey)).toEqual(["new"]); });
  });
});
