import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { orgAdminMutation, orgQuery, requireUserId } from "./lib/tenancy";
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
    const { byoAnthropicKeyEnc, ...rest } = s;
    return { ...rest, hasByoKey: Boolean(byoAnthropicKeyEnc) };
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
