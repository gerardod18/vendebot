/**
 * Tenant isolation. EVERY public function that touches tenant data must be built with one of the
 * builders below (orgQuery / orgMutation / orgAdminMutation). They:
 *   1. require a signed-in user (identity.subject = Better Auth user id),
 *   2. require a `members` row for (orgId, userId),
 *   3. optionally require a minimum role,
 * and expose `ctx.orgId`, `ctx.userId`, `ctx.role` to the handler.
 * Handlers must still filter every table read/write by `ctx.orgId`.
 */
import { customMutation, customQuery } from "convex-helpers/server/customFunctions";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";

export type Role = "owner" | "admin" | "agent";
const RANK: Record<Role, number> = { agent: 1, admin: 2, owner: 3 };

export async function requireUserId(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  return identity.subject;
}

export async function requireMember(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"orgs">,
  minRole: Role = "agent",
) {
  const userId = await requireUserId(ctx);
  const member = await ctx.db
    .query("members")
    .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", userId))
    .unique();
  // Same error for "no such org" and "not a member" so org ids can't be probed.
  if (!member) throw new Error("Forbidden");
  if (RANK[member.role] < RANK[minRole]) throw new Error("Forbidden: insufficient role");
  return { userId, orgId, role: member.role as Role };
}

export const orgQuery = customQuery(query, {
  args: { orgId: v.id("orgs") },
  input: async (ctx, { orgId }) => ({ ctx: await requireMember(ctx, orgId), args: {} }),
});

export const orgMutation = customMutation(mutation, {
  args: { orgId: v.id("orgs") },
  input: async (ctx, { orgId }) => ({ ctx: await requireMember(ctx, orgId), args: {} }),
});

export const orgAdminMutation = customMutation(mutation, {
  args: { orgId: v.id("orgs") },
  input: async (ctx, { orgId }) => ({ ctx: await requireMember(ctx, orgId, "admin"), args: {} }),
});

export const orgAdminQuery = customQuery(query, {
  args: { orgId: v.id("orgs") },
  input: async (ctx, { orgId }) => ({ ctx: await requireMember(ctx, orgId, "admin"), args: {} }),
});
