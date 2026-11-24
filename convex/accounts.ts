import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { buildUnifiedAuthUrl, oauthRedirectUri } from "./instagram/oauth";
import { createIgClient } from "./instagram/client";
import { createWhatsAppClient } from "./whatsapp/client";
import { decryptSecret, encryptSecret } from "./lib/crypto";
import { orgAdminMutation, orgQuery } from "./lib/tenancy";

/** Connected Instagram accounts of this workspace (never exposes tokens). */
export const list = orgQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("igAccounts").withIndex("by_org", (q) => q.eq("orgId", ctx.orgId)).collect();
    return rows.map((a) => ({
      accountId: a._id, igUserId: a.igUserId, channel: a.channel ?? ("instagram" as const), username: a.username, name: a.name, profilePictureUrl: a.profilePictureUrl,
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
  tokenEnc: string; tokenExpiresAt: number; channel?: "instagram" | "whatsapp"; wabaId?: string;
};

/** Create or reactivate the account. A channel account may belong to only one workspace. */
async function upsertAccountRow(ctx: MutationCtx, a: UpsertArgs) {
  const existing = await ctx.db.query("igAccounts").withIndex("by_igUserId", (q) => q.eq("igUserId", a.igUserId)).unique();
  if (existing && existing.orgId !== a.orgId && existing.status !== "revoked") {
    throw new Error("This account is already connected to another workspace");
  }
  const fields = {
    username: a.username, name: a.name, profilePictureUrl: a.profilePictureUrl, tokenEnc: a.tokenEnc,
    tokenExpiresAt: a.tokenExpiresAt, status: "active" as const, connectedBy: a.userId,
    channel: a.channel, wabaId: a.wabaId,
  };
  if (existing) {
    await ctx.db.patch(existing._id, { ...fields, orgId: a.orgId });
    return existing._id;
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

/**
 * Connect a WhatsApp number by pasting its phone_number_id, WABA id and an access token
 * (a permanent system-user token, or the temporary one from the API Setup page for a demo).
 * The token is encrypted at rest; verification and webhook subscription run right after.
 */
export const connectWhatsApp = orgAdminMutation({
  args: { phoneNumberId: v.string(), wabaId: v.string(), accessToken: v.string() },
  handler: async (ctx, a) => {
    const encKey = process.env.TOKEN_ENCRYPTION_KEY;
    if (!encKey) throw new Error("Server is not configured (TOKEN_ENCRYPTION_KEY)");
    const phoneNumberId = a.phoneNumberId.trim(), wabaId = a.wabaId.trim(), token = a.accessToken.trim();
    if (!/^\d{5,25}$/.test(phoneNumberId) || !/^\d{5,25}$/.test(wabaId)) throw new Error("Phone number id and WABA id must be numeric ids");
    if (token.length < 20) throw new Error("Access token looks too short");
    const accountId = await upsertAccountRow(ctx, {
      orgId: ctx.orgId, userId: ctx.userId, igUserId: phoneNumberId, username: phoneNumberId,
      tokenEnc: await encryptSecret(token, encKey), tokenExpiresAt: Date.now() + TEN_YEARS_MS, channel: "whatsapp", wabaId,
    });
    await ctx.scheduler.runAfter(0, internal.accounts.verifyWhatsApp, { accountId });
    return { accountId };
  },
});

export const loadForVerify = internalQuery({
  args: { accountId: v.id("igAccounts") },
  handler: async (ctx, { accountId }) => {
    const a = await ctx.db.get(accountId);
    return a && a.channel === "whatsapp" ? { phoneNumberId: a.igUserId, wabaId: a.wabaId, tokenEnc: a.tokenEnc } : null;
  },
});

export const setDisplay = internalMutation({
  args: { accountId: v.id("igAccounts"), username: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, { accountId, ...p }) => {
    await ctx.db.patch(accountId, p);
  },
});

export const markExpired = internalMutation({
  args: { accountId: v.id("igAccounts") },
  handler: async (ctx, { accountId }) => {
    await ctx.db.patch(accountId, { status: "expired", webhookSubscribed: false });
  },
});

/** Checks the pasted credentials, stores the display number and subscribes the app to the WABA. */
export const verifyWhatsApp = internalAction({
  args: { accountId: v.id("igAccounts") },
  handler: async (ctx, { accountId }) => {
    const encKey = process.env.TOKEN_ENCRYPTION_KEY;
    const t = await ctx.runQuery(internal.accounts.loadForVerify, { accountId });
    if (!t || !encKey) return;
    const client = createWhatsAppClient({
      accessToken: await decryptSecret(t.tokenEnc, encKey), phoneNumberId: t.phoneNumberId, graphVersion: process.env.META_GRAPH_VERSION,
    });
    try {
      const info = await client.getPhoneNumber();
      await ctx.runMutation(internal.accounts.setDisplay, { accountId, username: info.displayPhoneNumber, name: info.verifiedName });
    } catch {
      await ctx.runMutation(internal.accounts.markExpired, { accountId }); // bad token / wrong phone number id
      return;
    }
    try {
      if (t.wabaId) await client.subscribeWaba(t.wabaId);
      await ctx.runMutation(internal.accounts.markSubscribed, { accountId, subscribed: Boolean(t.wabaId) });
    } catch {
      await ctx.runMutation(internal.accounts.markSubscribed, { accountId, subscribed: false });
    }
  },
});

export const markSubscribed = internalMutation({
  args: { accountId: v.id("igAccounts"), subscribed: v.boolean() },
  handler: async (ctx, { accountId, subscribed }) => {
    await ctx.db.patch(accountId, { webhookSubscribed: subscribed });
  },
});

/** Subscribe the account to webhook fields after OAuth. */
export const subscribeWebhooks = internalAction({
  args: { accountId: v.id("igAccounts"), igUserId: v.string(), token: v.string() },
  handler: async (ctx, a) => {
    try {
      await createIgClient({ accessToken: a.token, igUserId: a.igUserId, graphVersion: process.env.META_GRAPH_VERSION }).subscribeWebhooks();
      await ctx.runMutation(internal.accounts.markSubscribed, { accountId: a.accountId, subscribed: true });
    } catch {
      await ctx.runMutation(internal.accounts.markSubscribed, { accountId: a.accountId, subscribed: false });
    }
  },
});
