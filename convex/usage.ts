import { currentMonth, quotaForPlan } from "./lib/plans";
import { orgQuery } from "./lib/tenancy";

export const summary = orgQuery({
  args: {},
  handler: async (ctx) => {
    const s = await ctx.db.query("orgSettings").withIndex("by_org", (q) => q.eq("orgId", ctx.orgId)).unique();
    const rows = (await ctx.db.query("usage").withIndex("by_org_month", (q) => q.eq("orgId", ctx.orgId)).order("desc").take(6));
    const month = currentMonth();
    const cur = rows.find((r) => r.month === month);
    const ownKey = Boolean((s?.aiProvider === "openrouter" ? s.byoOpenRouterKeyEnc : s?.byoAnthropicKeyEnc));
    return {
      month,
      plan: s?.plan ?? "free",
      aiMonthlyQuota: s?.aiMonthlyQuota ?? quotaForPlan("free"),
      unlimited: ownKey,
      current: cur ?? { aiReplies: 0, inputTokens: 0, outputTokens: 0, costUsdMicros: 0, outboundMessages: 0 },
      history: rows.map((r) => ({ month: r.month, aiReplies: r.aiReplies, outboundMessages: r.outboundMessages, costUsdMicros: r.costUsdMicros })),
    };
  },
});
