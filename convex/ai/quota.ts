import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { currentMonth } from "../lib/plans";

async function usageDoc(ctx: QueryCtx, orgId: Id<"orgs">, month: string) {
  return ctx.db.query("usage").withIndex("by_org_month", (q) => q.eq("orgId", orgId).eq("month", month)).unique();
}

/** True when the org can still make an AI reply this month. */
export async function aiQuotaAvailable(ctx: QueryCtx, orgId: Id<"orgs">, now = Date.now()): Promise<boolean> {
  const s = await ctx.db.query("orgSettings").withIndex("by_org", (q) => q.eq("orgId", orgId)).unique();
  if (!s) return false;
  const u = await usageDoc(ctx, orgId, currentMonth(now));
  return (u?.aiReplies ?? 0) < s.aiMonthlyQuota;
}

async function ensureUsage(ctx: MutationCtx, orgId: Id<"orgs">, now: number) {
  const month = currentMonth(now);
  const existing = await usageDoc(ctx, orgId, month);
  if (existing) return existing;
  const id = await ctx.db.insert("usage", { orgId, month, aiReplies: 0, inputTokens: 0, outputTokens: 0, costUsdMicros: 0, outboundMessages: 0 });
  return (await ctx.db.get(id))!;
}

/** Reserve one AI reply. Returns false (and reserves nothing) when the quota is exhausted. */
export async function reserveAiReply(ctx: MutationCtx, orgId: Id<"orgs">, now = Date.now()): Promise<boolean> {
  if (!(await aiQuotaAvailable(ctx, orgId, now))) return false;
  const u = await ensureUsage(ctx, orgId, now);
  await ctx.db.patch(u._id, { aiReplies: u.aiReplies + 1 });
  return true;
}

export async function recordTokens(
  ctx: MutationCtx, orgId: Id<"orgs">, t: { inputTokens: number; outputTokens: number; costUsdMicros: number }, now = Date.now(),
) {
  const u = await ensureUsage(ctx, orgId, now);
  await ctx.db.patch(u._id, {
    inputTokens: u.inputTokens + t.inputTokens,
    outputTokens: u.outputTokens + t.outputTokens,
    costUsdMicros: u.costUsdMicros + t.costUsdMicros,
  });
}

export async function recordOutbound(ctx: MutationCtx, orgId: Id<"orgs">, n = 1, now = Date.now()) {
  const u = await ensureUsage(ctx, orgId, now);
  await ctx.db.patch(u._id, { outboundMessages: u.outboundMessages + n });
}
