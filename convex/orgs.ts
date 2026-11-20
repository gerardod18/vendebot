import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { DEFAULT_PROVIDER, validateModelId } from "./ai/models";
import { encryptSecret } from "./lib/crypto";
import { orgAdminMutation, orgAdminQuery, orgQuery, requireUserId } from "./lib/tenancy";
import { roleValidator } from "./schema";

export const DEFAULT_SETTINGS = {
  plan: "free",
  aiModel: "claude-haiku-5-5",
  aiMonthlyQuota: 200,
  timezone: "UTC",
  businessHours: { days: [1, 2, 3, 4, 5], start: "08:00", end: "17:00" },
  defaultLanguage: "es",
} as const;

export function slugify(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "workspace";
}

/** Create a workspace; the caller becomes its owner. */
export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await requireUserId(ctx);
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 60) throw new Error("Name must be 2-60 characters");

    let slug = slugify(trimmed);
    while (await ctx.db.query("orgs").withIndex("by_slug", (q) => q.eq("slug", slug)).unique()) {
      slug = `${slugify(trimmed)}-${Math.random().toString(36).slice(2, 6)}`;
    }
    const orgId = await ctx.db.insert("orgs", { name: trimmed, slug, createdBy: userId });
    await ctx.db.insert("members", { orgId, userId, role: "owner" });
    await ctx.db.insert("orgSettings", { orgId, ...DEFAULT_SETTINGS, businessHours: { ...DEFAULT_SETTINGS.businessHours, days: [...DEFAULT_SETTINGS.businessHours.days] } });
    return orgId;
  },
});

/** Workspaces the signed-in user belongs to. */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const memberships = await ctx.db
      .query("members")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect();
    const out = [];
    for (const m of memberships) {
      const org = await ctx.db.get(m.orgId);
      if (org) out.push({ orgId: org._id, name: org.name, slug: org.slug, role: m.role });
    }
    return out;
  },
});

export const listMembers = orgQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", ctx.orgId))
      .collect();
  },
});

export const getSettings = orgQuery({
  args: {},
  handler: async (ctx) => {
    const s = await ctx.db.query("orgSettings").withIndex("by_org", (q) => q.eq("orgId", ctx.orgId)).unique();
    if (!s) return null;
    // Never expose the encrypted BYO key to clients, only whether one is set.
    const { byoAnthropicKeyEnc, byoOpenRouterKeyEnc, ...rest } = s;
    const provider = rest.aiProvider ?? DEFAULT_PROVIDER;
    return {
      ...rest,
      aiProvider: provider,
      hasByoKey: Boolean(provider === "openrouter" ? byoOpenRouterKeyEnc : byoAnthropicKeyEnc),
    };
  },
});

/**
 * Choose the AI provider and model for this workspace, optionally storing the org's own API key
 * (encrypted). `apiKey`: omit to keep the current key, "" to remove it, a value to replace it.
 */
export const setAiConfig = orgAdminMutation({
  args: {
    provider: v.union(v.literal("anthropic"), v.literal("openrouter")),
    model: v.string(),
    apiKey: v.optional(v.string()),
  },
  handler: async (ctx, { provider, model, apiKey }) => {
    const modelId = model.trim();
    const err = validateModelId(provider, modelId);
    if (err) throw new Error(err);

    const s = await ctx.db.query("orgSettings").withIndex("by_org", (q) => q.eq("orgId", ctx.orgId)).unique();
    if (!s) throw new Error("Settings not found");

    const patch: Partial<Doc<"orgSettings">> = { aiProvider: provider, aiModel: modelId };
    if (apiKey !== undefined) {
      const field = provider === "openrouter" ? "byoOpenRouterKeyEnc" : "byoAnthropicKeyEnc";
      const trimmed = apiKey.trim();
      if (trimmed === "") {
        patch[field] = undefined;
      } else {
        const encKey = process.env.TOKEN_ENCRYPTION_KEY;
        if (!encKey) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
        patch[field] = await encryptSecret(trimmed, encKey);
      }
    }
    await ctx.db.patch(s._id, patch);
  },
});

export const setMemberRole = orgAdminMutation({
  args: { memberUserId: v.string(), role: roleValidator },
  handler: async (ctx, { memberUserId, role }) => {
    const target = await ctx.db
      .query("members")
      .withIndex("by_org_user", (q) => q.eq("orgId", ctx.orgId).eq("userId", memberUserId))
      .unique();
    if (!target) throw new Error("Member not found");
    if (target.role === "owner" || role === "owner") throw new Error("Owner role cannot be changed here");
    await ctx.db.patch(target._id, { role });
  },
});

/** Workspace preferences: timezone, business hours, language and the business-wide AI instructions. */
export const updateSettings = orgAdminMutation({
  args: {
    timezone: v.optional(v.string()),
    businessHours: v.optional(v.object({ days: v.array(v.number()), start: v.string(), end: v.string() })),
    defaultLanguage: v.optional(v.string()),
    aiInstructions: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const s = await ctx.db.query("orgSettings").withIndex("by_org", (q) => q.eq("orgId", ctx.orgId)).unique();
    if (!s) throw new Error("Settings not found");
    const patch: Partial<Doc<"orgSettings">> = {};
    if (a.timezone !== undefined) {
      try { new Intl.DateTimeFormat("en-US", { timeZone: a.timezone }); } catch { throw new Error("Invalid timezone"); }
      patch.timezone = a.timezone;
    }
    if (a.businessHours) {
      const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!hhmm.test(a.businessHours.start) || !hhmm.test(a.businessHours.end)) throw new Error("Hours must be HH:MM");
      if (a.businessHours.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error("Days must be 0-6");
      patch.businessHours = a.businessHours;
    }
    if (a.defaultLanguage !== undefined) {
      if (!/^[a-z]{2}$/.test(a.defaultLanguage)) throw new Error("Language must be a 2-letter code");
      patch.defaultLanguage = a.defaultLanguage;
    }
    if (a.aiInstructions !== undefined) {
      if (a.aiInstructions.length > 4000) throw new Error("AI instructions are limited to 4000 characters");
      patch.aiInstructions = a.aiInstructions.trim() || undefined;
    }
    await ctx.db.patch(s._id, patch);
  },
});

// ---- Invites ----
const INVITE_TTL_MS = 7 * 24 * 3600_000;

export const invite = orgAdminMutation({
  args: { email: v.string(), role: roleValidator },
  handler: async (ctx, { email, role }) => {
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error("Invalid email");
    if (role === "owner") throw new Error("Invite as admin or agent");
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    await ctx.db.insert("invites", { orgId: ctx.orgId, email: e, role, token, invitedBy: ctx.userId, expiresAt: Date.now() + INVITE_TTL_MS });
    return { token }; // share as <app>/invite/<token>; email delivery is not wired up
  },
});

export const listInvites = orgAdminQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("invites").withIndex("by_org", (q) => q.eq("orgId", ctx.orgId)).collect();
    return rows.filter((i) => !i.acceptedAt && i.expiresAt > Date.now()).map((i) => ({ id: i._id, email: i.email, role: i.role, token: i.token, expiresAt: i.expiresAt }));
  },
});

export const revokeInvite = orgAdminMutation({
  args: { inviteId: v.id("invites") },
  handler: async (ctx, { inviteId }) => {
    const i = await ctx.db.get(inviteId);
    if (!i || i.orgId !== ctx.orgId) throw new Error("Invite not found");
    await ctx.db.delete(inviteId);
  },
});

/** Accept an invite as the signed-in user. The token is the secret; it is single use and expires. */
export const acceptInvite = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const userId = await requireUserId(ctx);
    const inv = await ctx.db.query("invites").withIndex("by_token", (q) => q.eq("token", token)).unique();
    if (!inv || inv.acceptedAt || inv.expiresAt < Date.now()) throw new Error("Invite is invalid or expired");
    const existing = await ctx.db.query("members").withIndex("by_org_user", (q) => q.eq("orgId", inv.orgId).eq("userId", userId)).unique();
    if (!existing) await ctx.db.insert("members", { orgId: inv.orgId, userId, role: inv.role });
    await ctx.db.patch(inv._id, { acceptedAt: Date.now() });
    return inv.orgId;
  },
});

export const removeMember = orgAdminMutation({
  args: { memberUserId: v.string() },
  handler: async (ctx, { memberUserId }) => {
    const target = await ctx.db.query("members").withIndex("by_org_user", (q) => q.eq("orgId", ctx.orgId).eq("userId", memberUserId)).unique();
    if (!target) throw new Error("Member not found");
    if (target.role === "owner") throw new Error("The owner cannot be removed");
    if (target.role === "admin" && ctx.role !== "owner") throw new Error("Only the owner can remove an admin");
    await ctx.db.delete(target._id);
  },
});
