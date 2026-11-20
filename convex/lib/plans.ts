/** Plans → limits. The billing provider (Stripe/Polar) webhook should set orgSettings.plan to one of these keys. */
export const PLANS = {
  free: { label: "Free", aiMonthlyQuota: 200 },
  starter: { label: "Starter", aiMonthlyQuota: 2000 },
  pro: { label: "Pro", aiMonthlyQuota: 10000 },
} as const;
export type PlanKey = keyof typeof PLANS;
export const isPlan = (s: string): s is PlanKey => s in PLANS;
export const quotaForPlan = (s: string): number => (isPlan(s) ? PLANS[s].aiMonthlyQuota : PLANS.free.aiMonthlyQuota);
export const currentMonth = (now = Date.now()): string => new Date(now).toISOString().slice(0, 7);
