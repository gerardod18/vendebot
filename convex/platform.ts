/**
 * Platform (superAdmin) functions. These are the only cross-tenant reads and the only place the AI provider
 * for the whole service is decided. Access: a `superAdmins` row bound to the signed-in user. The first operator
 * claims the role with an email listed in the SUPERADMIN_EMAILS env var (comma separated); after that, operators
 * grant others by email. Config changes, grants and workspace views are written to `adminAudit`.
 */
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { DEFAULT_MODEL, DEFAULT_PROVIDER, validateModelId } from "./ai/models";
import { encryptSecret } from "./lib/crypto";
import { currentMonth } from "./lib/plans";
import { requireUserId, superAdminMutation, superAdminQuery } from "./lib/tenancy";

const envEmails = () => (process.env.SUPERADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

async function emailOf(ctx: QueryCtx | MutationCtx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.email ? identity.email.toLowerCase() : null;
}

async function audit(ctx: MutationCtx, userId: string, action: string, extra: { orgId?: Id<"orgs">; detail?: string } = {}) {
  await ctx.db.insert("adminAudit", { userId, action, at: Date.now(), ...extra });
}

/** What the UI needs to decide whether to show the Plataforma section. Reveals nothing else. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { isSuperAdmin: false, canClaim: false };
    const active = await ctx.db.query("superAdmins").withIndex("by_userId", (q) => q.eq("userId", identity.subject)).unique();
    if (active) return { isSuperAdmin: true, canClaim: false };
    const email = await emailOf(ctx);
    if (!email) return { isSuperAdmin: false, canClaim: false };
    const pending = await ctx.db.query("superAdmins").withIndex("by_email", (q) => q.eq("email", email)).unique();
    return { isSuperAdmin: false, canClaim: envEmails().includes(email) || Boolean(pending && !pending.userId) };
  },
});

/** Activate the role for the signed-in user when their email is authorised (env list or a pending grant). */
export const claim = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const email = await emailOf(ctx);
    if (!email) throw new Error("Forbidden");
    const row = await ctx.db.query("superAdmins").withIndex("by_email", (q) => q.eq("email", email)).unique();
    if (row?.userId) {
      if (row.userId === userId) return { ok: true };
      throw new Error("Forbidden");
    }
    if (!row && !envEmails().includes(email)) throw new Error("Forbidden");
    if (row) await ctx.db.patch(row._id, { userId, claimedAt: Date.now() });
    else await ctx.db.insert("superAdmins", { email, userId, addedBy: userId, claimedAt: Date.now() });
    await audit(ctx, userId, "superadmin.claim", { detail: email });
    return { ok: true };
  },
});

export const listAdmins = superAdminQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("superAdmins").collect()).map((a) => ({ id: a._id, email: a.email, active: Boolean(a.userId), claimedAt: a.claimedAt ?? null })),
});

export const grantAdmin = superAdminMutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error("Escribe un correo válido");
    const existing = await ctx.db.query("superAdmins").withIndex("by_email", (q) => q.eq("email", e)).unique();
    if (existing) throw new Error("Ese correo ya tiene acceso");
    await ctx.db.insert("superAdmins", { email: e, addedBy: ctx.userId });
    await audit(ctx, ctx.userId, "superadmin.grant", { detail: e });
  },
});

export const revokeAdmin = superAdminMutation({
  args: { id: v.id("superAdmins") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row) return;
    const active = (await ctx.db.query("superAdmins").collect()).filter((a) => a.userId);
    if (row.userId && active.length <= 1) throw new Error("Debe quedar al menos un superadministrador");
    await ctx.db.delete(id);
    await audit(ctx, ctx.userId, "superadmin.revoke", { detail: row.email });
  },
});

// ---- AI provider for the whole service ----

export const getAiConfig = superAdminQuery({
  args: {},
  handler: async (ctx) => {
    const s = await ctx.db.query("platformSettings").withIndex("by_key", (q) => q.eq("key", "ai")).unique();
    return {
      provider: s?.aiProvider ?? DEFAULT_PROVIDER,
      model: s?.aiModel ?? DEFAULT_MODEL,
      hasAnthropicKey: Boolean(s?.anthropicKeyEnc),
      hasOpenRouterKey: Boolean(s?.openRouterKeyEnc),
      envAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
      envOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY),
      updatedAt: s?.updatedAt ?? null,
    };
  },
});

/** Keys: omit to keep, "" to remove, a value to replace (stored encrypted, never returned). */
export const setAiConfig = superAdminMutation({
  args: {
    provider: v.union(v.literal("anthropic"), v.literal("openrouter")),
    model: v.string(),
    anthropicKey: v.optional(v.string()),
    openRouterKey: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const model = a.model.trim();
    const err = validateModelId(a.provider, model);
    if (err) throw new Error(err);
    const encKey = process.env.TOKEN_ENCRYPTION_KEY;
    const enc = async (raw: string | undefined, current: string | undefined) => {
      if (raw === undefined) return current;
      const t = raw.trim();
      if (!t) return undefined;
      if (!encKey) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
      return encryptSecret(t, encKey);
    };
    const s = await ctx.db.query("platformSettings").withIndex("by_key", (q) => q.eq("key", "ai")).unique();
    const next = {
      key: "ai" as const, aiProvider: a.provider, aiModel: model,
      anthropicKeyEnc: await enc(a.anthropicKey, s?.anthropicKeyEnc),
      openRouterKeyEnc: await enc(a.openRouterKey, s?.openRouterKeyEnc),
      updatedBy: ctx.userId, updatedAt: Date.now(),
    };
    if (s) await ctx.db.replace(s._id, next); else await ctx.db.insert("platformSettings", next);
    await audit(ctx, ctx.userId, "ai.config", { detail: `${a.provider}:${model}` });
  },
});

// ---- Cross-tenant reads ----

export const overview = superAdminQuery({
  args: {},
  handler: async (ctx) => {
    const month = currentMonth();
    const orgs = await ctx.db.query("orgs").order("desc").take(200);
    return Promise.all(orgs.map(async (o) => {
      const [members, accounts, triggers, convs, usage, settings] = await Promise.all([
        ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", o._id)).collect(),
        ctx.db.query("igAccounts").withIndex("by_org", (q) => q.eq("orgId", o._id)).collect(),
        ctx.db.query("triggers").withIndex("by_org", (q) => q.eq("orgId", o._id)).collect(),
        ctx.db.query("conversations").withIndex("by_org_lastMessageAt", (q) => q.eq("orgId", o._id)).order("desc").take(500),
        ctx.db.query("usage").withIndex("by_org_month", (q) => q.eq("orgId", o._id).eq("month", month)).unique(),
        ctx.db.query("orgSettings").withIndex("by_org", (q) => q.eq("orgId", o._id)).unique(),
      ]);
      return {
        orgId: o._id, name: o.name, createdAt: o._creationTime, plan: settings?.plan ?? "free",
        members: members.length,
        accounts: accounts.filter((a) => a.status === "active").length,
        automations: triggers.length,
        conversations: convs.length,
        lastActivityAt: convs[0]?.lastMessageAt ?? null,
        aiReplies: usage?.aiReplies ?? 0, aiQuota: settings?.aiMonthlyQuota ?? 0, costUsdMicros: usage?.costUsdMicros ?? 0,
      };
    }));
  },
});

export const orgDetail = superAdminQuery({
  args: { orgId: v.id("orgs") },
  handler: async (ctx, { orgId }) => {
    const org = await ctx.db.get(orgId);
    if (!org) return null;
    const [members, accounts, triggers, convs, usage, settings, runs] = await Promise.all([
      ctx.db.query("members").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("igAccounts").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("triggers").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect(),
      ctx.db.query("conversations").withIndex("by_org_lastMessageAt", (q) => q.eq("orgId", orgId)).order("desc").take(25),
      ctx.db.query("usage").withIndex("by_org_month", (q) => q.eq("orgId", orgId)).order("desc").take(6),
      ctx.db.query("orgSettings").withIndex("by_org", (q) => q.eq("orgId", orgId)).unique(),
      ctx.db.query("flowRuns").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").take(100),
    ]);
    const flows = await Promise.all(triggers.map((t) => ctx.db.get(t.flowId)));
    const contacts = await Promise.all(convs.map((c) => ctx.db.get(c.contactId)));
    return {
      orgId, name: org.name, createdAt: org._creationTime,
      settings: settings ? { plan: settings.plan, aiMonthlyQuota: settings.aiMonthlyQuota, timezone: settings.timezone, defaultLanguage: settings.defaultLanguage } : null,
      members: members.map((m) => ({ userId: m.userId, role: m.role })),
      accounts: accounts.map((a) => ({ id: a._id, channel: a.channel ?? "instagram", username: a.username, status: a.status, webhookSubscribed: a.webhookSubscribed })),
      automations: triggers.map((t, i) => ({ id: t._id, name: flows[i]?.name ?? "", type: t.type, enabled: t.enabled, firedCount: t.firedCount })),
      conversations: convs.map((c, i) => ({
        id: c._id, contact: contacts[i]?.name ?? contacts[i]?.username ?? contacts[i]?.igsid ?? "", mode: c.mode,
        preview: c.lastMessagePreview ?? "", lastMessageAt: c.lastMessageAt, unread: c.unread,
      })),
      usage: usage.map((u) => ({ month: u.month, aiReplies: u.aiReplies, outboundMessages: u.outboundMessages, costUsdMicros: u.costUsdMicros })),
      failedRuns: runs.filter((r) => r.status === "failed").slice(0, 10).map((r) => ({ id: r._id, error: r.error ?? "", at: r.endedAt ?? r._creationTime })),
    };
  },
});

/** Records that a superAdmin opened a workspace (customer data is being viewed). */
export const recordView = superAdminMutation({
  args: { orgId: v.id("orgs") },
  handler: async (ctx, { orgId }) => audit(ctx, ctx.userId, "org.view", { orgId }),
});

export const recentAudit = superAdminQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query("adminAudit").withIndex("by_at").order("desc").take(50))
    .map((a) => ({ id: a._id, userId: a.userId, action: a.action, orgId: a.orgId ?? null, detail: a.detail ?? null, at: a.at })),
});
