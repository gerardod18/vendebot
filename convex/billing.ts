/**
 * Billing → plan sync. The provider adapter (Stripe/Polar) is NOT implemented: it needs the owner's account.
 * Whatever adapter is added must call `applyPlan` (or POST /billing/webhook with the HMAC below). Users cannot
 * change their own plan from the client.
 */
import { v } from "convex/values";
import { httpAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { isPlan, quotaForPlan } from "./lib/plans";

export const applyPlan = internalMutation({
  args: { orgId: v.id("orgs"), plan: v.string() },
  handler: async (ctx, { orgId, plan }) => {
    if (!isPlan(plan)) throw new Error(`Unknown plan "${plan}"`);
    const s = await ctx.db.query("orgSettings").withIndex("by_org", (q) => q.eq("orgId", orgId)).unique();
    if (!s) throw new Error("Workspace settings not found");
    await ctx.db.patch(s._id, { plan, aiMonthlyQuota: quotaForPlan(plan) });
  },
});

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** POST /billing/webhook  body {"orgId": "...", "plan": "pro"}  header x-billing-signature = hex HMAC-SHA256(body, BILLING_WEBHOOK_SECRET). */
export const webhook = httpAction(async (ctx, request) => {
  const secret = process.env.BILLING_WEBHOOK_SECRET;
  if (!secret) return new Response("Not configured", { status: 500 });
  const body = await request.text();
  const expected = await hmacHex(secret, body);
  const got = request.headers.get("x-billing-signature") ?? "";
  let diff = expected.length ^ got.length;
  for (let i = 0; i < Math.min(expected.length, got.length); i++) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  if (diff !== 0) return new Response("Invalid signature", { status: 401 });
  try {
    const { orgId, plan } = JSON.parse(body);
    await ctx.runMutation(internal.billing.applyPlan, { orgId, plan });
    return new Response("ok");
  } catch {
    return new Response("Bad request", { status: 400 });
  }
});
