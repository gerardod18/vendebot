import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { buildAuthUrl } from "./instagram/oauth";
import { createIgClient, refreshLongLivedToken } from "./instagram/client";
import { decryptSecret, encryptSecret } from "./lib/crypto";
import { orgAdminMutation, orgQuery } from "./lib/tenancy";

/** Connected Instagram accounts of this workspace (never exposes tokens). */
export const list = orgQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("igAccounts").withIndex("by_org", (q) => q.eq("orgId", ctx.orgId)).collect();
    return rows.map((a) => ({
      accountId: a._id, igUserId: a.igUserId, username: a.username, name: a.name, profilePictureUrl: a.profilePictureUrl,
      status: a.status, tokenExpiresAt: a.tokenExpiresAt, webhookSubscribed: a.webhookSubscribed,
    }));
  },
});

/** Step 1 of "Connect Instagram": returns the Instagram authorization URL. Also used to reconnect. */
export const startConnect = orgAdminMutation({
  args: {},
  handler: async (ctx) => {
    const appId = process.env.META_APP_ID;
    const site = process.env.CONVEX_SITE_URL;
    if (!appId || !site) throw new Error("Instagram connection is not configured (META_APP_ID / CONVEX_SITE_URL)");
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const state = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    await ctx.db.insert("oauthStates", { orgId: ctx.orgId, userId: ctx.userId, state, expiresAt: Date.now() + 10 * 60_000 });
    return { url: buildAuthUrl({ appId, redirectUri: `${site}/meta/oauth/callback`, state }) };
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

/** Create or reactivate the account. An Instagram account may belong to only one workspace. */
export const upsertAccount = internalMutation({
  args: {
    orgId: v.id("orgs"), userId: v.string(), igUserId: v.string(), username: v.string(),
    name: v.optional(v.string()), profilePictureUrl: v.optional(v.string()),
    tokenEnc: v.string(), tokenExpiresAt: v.number(),
  },
  handler: async (ctx, a) => {
    const existing = await ctx.db.query("igAccounts").withIndex("by_igUserId", (q) => q.eq("igUserId", a.igUserId)).unique();
    if (existing && existing.orgId !== a.orgId && existing.status !== "revoked") {
      throw new Error("This Instagram account is already connected to another workspace");
    }
    const fields = {
      username: a.username, name: a.name, profilePictureUrl: a.profilePictureUrl, tokenEnc: a.tokenEnc,
      tokenExpiresAt: a.tokenExpiresAt, status: "active" as const, connectedBy: a.userId,
    };
    if (existing) {
      await ctx.db.patch(existing._id, { ...fields, orgId: a.orgId });
      return existing._id;
    }
    return ctx.db.insert("igAccounts", { orgId: a.orgId, igUserId: a.igUserId, webhookSubscribed: false, ...fields });
  },
});

export const markSubscribed = internalMutation({
  args: { accountId: v.id("igAccounts"), subscribed: v.boolean() },
  handler: async (ctx, { accountId, subscribed }) => {
    await ctx.db.patch(accountId, { webhookSubscribed: subscribed });
  },
});

// ---- Token refresh cron ----
const REFRESH_WINDOW_MS = 10 * 24 * 3600_000;

export const dueForRefresh = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("igAccounts").withIndex("by_tokenExpiresAt", (q) => q.lt("tokenExpiresAt", Date.now() + REFRESH_WINDOW_MS)).collect();
    return rows.filter((r) => r.status === "active").map((r) => ({ accountId: r._id, tokenEnc: r.tokenEnc }));
  },
});

export const saveRefreshed = internalMutation({
  args: { accountId: v.id("igAccounts"), tokenEnc: v.string(), tokenExpiresAt: v.number() },
  handler: async (ctx, { accountId, ...patch }) => {
    await ctx.db.patch(accountId, patch);
  },
});

export const refreshTokens = internalAction({
  args: {},
  handler: async (ctx) => {
    const encKey = process.env.TOKEN_ENCRYPTION_KEY;
    if (!encKey) return { refreshed: 0, expired: 0 };
    let refreshed = 0, expired = 0;
    for (const a of await ctx.runQuery(internal.accounts.dueForRefresh, {})) {
      try {
        const next = await refreshLongLivedToken(await decryptSecret(a.tokenEnc, encKey));
        await ctx.runMutation(internal.accounts.saveRefreshed, {
          accountId: a.accountId, tokenEnc: await encryptSecret(next.accessToken, encKey), tokenExpiresAt: next.expiresAt,
        });
        refreshed++;
      } catch {
        await ctx.runMutation(internal.outbound.markAccountExpired, { accountId: a.accountId });
        expired++;
      }
    }
    return { refreshed, expired };
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
