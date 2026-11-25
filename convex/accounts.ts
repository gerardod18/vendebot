import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { buildUnifiedAuthUrl, oauthRedirectUri } from "./instagram/oauth";
import { createIgClient } from "./instagram/client";
import { createWhatsAppClient } from "./whatsapp/client";
import { decryptSecret, encryptSecret } from "./lib/crypto";
import { ACCOUNT_UNAVAILABLE, isTransientMetaError, rowsFor, type AccountChannel } from "./lib/accounts";
import { orgAdminMutation, orgQuery, requireMemberOf } from "./lib/tenancy";

/** Connected Instagram accounts of this workspace (never exposes tokens). */
export const list = orgQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("igAccounts").withIndex("by_org", (q) => q.eq("orgId", ctx.orgId)).collect();
    return rows.map((a) => ({
      accountId: a._id, igUserId: a.igUserId, channel: a.channel ?? ("instagram" as const), wabaId: a.wabaId, username: a.username, name: a.name, profilePictureUrl: a.profilePictureUrl,
      status: a.status, tokenExpiresAt: a.tokenExpiresAt, webhookSubscribed: a.webhookSubscribed,
    }));
  },
});

/** Step 1 of "Connect Instagram": returns the Instagram authorization URL. Also used to reconnect. */
export const startConnect = orgAdminMutation({
  args: {},
  handler: async (ctx) => {
    const appId = process.env.META_APP_ID;
    const redirectUri = oauthRedirectUri();
    if (!appId || !redirectUri) throw new Error("Instagram connection is not configured (META_APP_ID / CONVEX_SITE_URL)");
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const state = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    await ctx.db.insert("oauthStates", { orgId: ctx.orgId, userId: ctx.userId, state, expiresAt: Date.now() + 10 * 60_000 });
    const configId = process.env.META_CONFIG_ID;
    if (!configId) throw new Error("Instagram connection needs META_CONFIG_ID (the login configuration id from the Meta dashboard)");
    return { url: buildUnifiedAuthUrl({ appId, configId, redirectUri, state }) };
  },
});

export const disconnect = orgAdminMutation({
  args: { accountId: v.id("igAccounts") },
  handler: async (ctx, { accountId }) => {
    const a = await ctx.db.get(accountId);
    if (!a || a.orgId !== ctx.orgId) throw new Error("Instagram account not found");
    // Keep the row (history, conversations) but kill the token and stop routing webhooks to it.
    await ctx.db.patch(accountId, { status: "revoked", tokenEnc: "", webhookSubscribed: false });
    const triggers = await ctx.db.query("triggers").withIndex("by_account", (q) => q.eq("igAccountId", accountId)).collect();
    for (const t of triggers) await ctx.db.patch(t._id, { enabled: false });
  },
});

/** Consume a one-time OAuth state. Returns who started the flow, or null if invalid/expired. */
export const consumeState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, { state }) => {
    const row = await ctx.db.query("oauthStates").withIndex("by_state", (q) => q.eq("state", state)).unique();
    if (!row) return null;
    await ctx.db.delete(row._id);
    return row.expiresAt < Date.now() ? null : { orgId: row.orgId, userId: row.userId };
  },
});

type UpsertArgs = {
  orgId: Id<"orgs">; userId: string; igUserId: string; username: string; name?: string; profilePictureUrl?: string;
  tokenEnc: string; tokenExpiresAt: number; channel?: AccountChannel; wabaId?: string;
};

/**
 * Create or reactivate this workspace's account row. Uniqueness is (channel, igUserId) among non-revoked rows.
 * A row owned by another workspace is NEVER adopted, not even a revoked one: the other workspace keeps its
 * history on that row and this workspace gets a fresh row. Conflicts return one generic error.
 */
async function upsertAccountRow(ctx: MutationCtx, a: UpsertArgs) {
  const rows = await rowsFor(ctx, a.channel ?? "instagram", a.igUserId);
  if (rows.some((r) => r.orgId !== a.orgId && r.status !== "revoked")) throw new Error(ACCOUNT_UNAVAILABLE);
  const own = rows.find((r) => r.orgId === a.orgId && r.status !== "revoked") ?? rows.find((r) => r.orgId === a.orgId);
  const fields = {
    username: a.username, name: a.name, profilePictureUrl: a.profilePictureUrl, tokenEnc: a.tokenEnc,
    tokenExpiresAt: a.tokenExpiresAt, status: "active" as const, connectedBy: a.userId,
    channel: a.channel, wabaId: a.wabaId,
  };
  if (own) {
    await ctx.db.patch(own._id, fields);
    return own._id;
  }
  return ctx.db.insert("igAccounts", { orgId: a.orgId, igUserId: a.igUserId, webhookSubscribed: false, ...fields });
}

export const upsertAccount = internalMutation({
  args: {
    orgId: v.id("orgs"), userId: v.string(), igUserId: v.string(), username: v.string(),
    name: v.optional(v.string()), profilePictureUrl: v.optional(v.string()),
    tokenEnc: v.string(), tokenExpiresAt: v.number(),
  },
  handler: (ctx, a) => upsertAccountRow(ctx, a),
});

const TEN_YEARS_MS = 10 * 365 * 24 * 3600_000;

/** Admin check for public actions (which have no `db`): the action passes the identity it resolved. */
export const assertAdmin = internalQuery({
  args: { orgId: v.id("orgs"), userId: v.string() },
  handler: async (ctx, { orgId, userId }) => {
    await requireMemberOf(ctx, orgId, userId, "admin");
  },
});

/**
 * Connect a WhatsApp number by pasting its phone_number_id, WABA id and an access token
 * (a permanent system-user token, or the temporary one from the API Setup page for a demo).
 * The credentials are verified with Meta BEFORE anything is written, so a wrong token can neither squat a
 * phone number id nor overwrite a working token. The token is encrypted at rest and never leaves this action
 * in plaintext (the mutation receives the ciphertext).
 */
export const connectWhatsApp = action({
  args: { orgId: v.id("orgs"), phoneNumberId: v.string(), wabaId: v.string(), accessToken: v.string() },
  handler: async (ctx, a): Promise<{ accountId: Id<"igAccounts"> }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");
    await ctx.runQuery(internal.accounts.assertAdmin, { orgId: a.orgId, userId: identity.subject });
    const encKey = process.env.TOKEN_ENCRYPTION_KEY;
    if (!encKey) throw new Error("Server is not configured (TOKEN_ENCRYPTION_KEY)");
    const phoneNumberId = a.phoneNumberId.trim(), wabaId = a.wabaId.trim(), token = a.accessToken.trim();
    if (!/^\d{5,25}$/.test(phoneNumberId) || !/^\d{5,25}$/.test(wabaId)) throw new Error("Phone number id and WABA id must be numeric ids");
    if (token.length < 20) throw new Error("Access token looks too short");

    let info: { displayPhoneNumber: string; verifiedName?: string };
    try {
      info = await createWhatsAppClient({ accessToken: token, phoneNumberId, graphVersion: process.env.META_GRAPH_VERSION }).getPhoneNumber();
    } catch (e) {
      throw new Error(isTransientMetaError(e) ? "Meta no respondió. Inténtalo de nuevo en unos minutos." : "No pudimos verificar el token y el Phone number ID con Meta.");
    }
    return ctx.runMutation(internal.accounts.saveWhatsApp, {
      orgId: a.orgId, userId: identity.subject, phoneNumberId, wabaId, tokenEnc: await encryptSecret(token, encKey),
      username: info.displayPhoneNumber, name: info.verifiedName,
    });
  },
});

/** Stores a WhatsApp account whose credentials were just verified, then schedules the webhook subscription. */
export const saveWhatsApp = internalMutation({
  args: {
    orgId: v.id("orgs"), userId: v.string(), phoneNumberId: v.string(), wabaId: v.string(), tokenEnc: v.string(),
    username: v.string(), name: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const accountId = await upsertAccountRow(ctx, {
      orgId: a.orgId, userId: a.userId, igUserId: a.phoneNumberId, username: a.username, name: a.name,
      tokenEnc: a.tokenEnc, tokenExpiresAt: Date.now() + TEN_YEARS_MS, channel: "whatsapp", wabaId: a.wabaId,
    });
    await ctx.scheduler.runAfter(0, internal.accounts.verifyWhatsApp, { accountId });
    return { accountId };
  },
});

export const loadForVerify = internalQuery({
  args: { accountId: v.id("igAccounts") },
  handler: async (ctx, { accountId }) => {
    const a = await ctx.db.get(accountId);
    return a && a.channel === "whatsapp" ? { phoneNumberId: a.igUserId, wabaId: a.wabaId, tokenEnc: a.tokenEnc, status: a.status } : null;
  },
});

// Status changes from background jobs only ever apply to a row that is still active: a job that raced with a
// disconnect must never turn `revoked` into `expired` or re-flag a revoked account.
export const setDisplay = internalMutation({
  args: { accountId: v.id("igAccounts"), username: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, { accountId, ...p }) => {
    const a = await ctx.db.get(accountId);
    if (a?.status === "active") await ctx.db.patch(accountId, p);
  },
});

export const markExpired = internalMutation({
  args: { accountId: v.id("igAccounts") },
  handler: async (ctx, { accountId }) => {
    const a = await ctx.db.get(accountId);
    if (a?.status === "active") await ctx.db.patch(accountId, { status: "expired", webhookSubscribed: false });
  },
});

const VERIFY_MAX_ATTEMPTS = 4;

/**
 * Re-checks the stored credentials, refreshes the display number and subscribes the app to the WABA.
 * Does nothing unless the account is still active. Network errors, 5xx and 429 are transient: retried with
 * backoff and the account stays active. Only an auth failure (code 190 / other 4xx) marks it expired.
 */
export const verifyWhatsApp = internalAction({
  args: { accountId: v.id("igAccounts"), attempt: v.optional(v.number()) },
  handler: async (ctx, { accountId, attempt }) => {
    const n = attempt ?? 0;
    const encKey = process.env.TOKEN_ENCRYPTION_KEY;
    const t = await ctx.runQuery(internal.accounts.loadForVerify, { accountId });
    if (!t || t.status !== "active" || !encKey) return;
    const retry = async () => {
      if (n + 1 >= VERIFY_MAX_ATTEMPTS) return false;
      await ctx.scheduler.runAfter(2 ** n * 30_000, internal.accounts.verifyWhatsApp, { accountId, attempt: n + 1 });
      return true;
    };
    let client: ReturnType<typeof createWhatsAppClient>;
    try {
      client = createWhatsAppClient({
        accessToken: await decryptSecret(t.tokenEnc, encKey), phoneNumberId: t.phoneNumberId, graphVersion: process.env.META_GRAPH_VERSION,
      });
      const info = await client.getPhoneNumber();
      await ctx.runMutation(internal.accounts.setDisplay, { accountId, username: info.displayPhoneNumber, name: info.verifiedName });
    } catch (e) {
      if (isTransientMetaError(e)) {
        if (!(await retry())) await ctx.runMutation(internal.accounts.markSubscribed, { accountId, subscribed: false });
        return;
      }
      await ctx.runMutation(internal.accounts.markExpired, { accountId }); // bad token / wrong phone number id
      return;
    }
    try {
      if (t.wabaId) await client.subscribeWaba(t.wabaId);
      await ctx.runMutation(internal.accounts.markSubscribed, { accountId, subscribed: Boolean(t.wabaId) });
    } catch (e) {
      // A rejected subscription (wrong WABA id) is not a bad token: the account stays active, flagged as unsubscribed.
      if (isTransientMetaError(e) && (await retry())) return;
      await ctx.runMutation(internal.accounts.markSubscribed, { accountId, subscribed: false });
    }
  },
});

export const markSubscribed = internalMutation({
  args: { accountId: v.id("igAccounts"), subscribed: v.boolean() },
  handler: async (ctx, { accountId, subscribed }) => {
    const a = await ctx.db.get(accountId);
    if (a?.status === "active") await ctx.db.patch(accountId, { webhookSubscribed: subscribed });
  },
});

export const loadForSubscribe = internalQuery({
  args: { accountId: v.id("igAccounts") },
  handler: async (ctx, { accountId }) => {
    const a = await ctx.db.get(accountId);
    return a && a.status === "active" && (a.channel ?? "instagram") === "instagram" ? { igUserId: a.igUserId, tokenEnc: a.tokenEnc } : null;
  },
});

/** Subscribe the account to webhook fields after OAuth. Only the account id travels through the scheduler; the token is decrypted here. */
export const subscribeWebhooks = internalAction({
  args: { accountId: v.id("igAccounts") },
  handler: async (ctx, { accountId }) => {
    const encKey = process.env.TOKEN_ENCRYPTION_KEY;
    const t = await ctx.runQuery(internal.accounts.loadForSubscribe, { accountId });
    if (!t || !encKey) return;
    try {
      await createIgClient({ accessToken: await decryptSecret(t.tokenEnc, encKey), igUserId: t.igUserId, graphVersion: process.env.META_GRAPH_VERSION }).subscribeWebhooks();
      await ctx.runMutation(internal.accounts.markSubscribed, { accountId, subscribed: true });
    } catch {
      await ctx.runMutation(internal.accounts.markSubscribed, { accountId, subscribed: false });
    }
  },
});
