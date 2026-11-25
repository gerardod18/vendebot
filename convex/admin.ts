/** Operational views (failed runs / events) and retention cleanup. */
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { orgAdminQuery } from "./lib/tenancy";

export const failedRuns = orgAdminQuery({
  args: {},
  handler: async (ctx) => {
    // (orgId, status) is in the index range: the newest 50 failed runs of THIS workspace, whatever other tenants do.
    const runs = await ctx.db.query("flowRuns").withIndex("by_org_status", (q) => q.eq("orgId", ctx.orgId).eq("status", "failed")).order("desc").take(50);
    const out = [];
    for (const r of runs) {
      const contact = await ctx.db.get(r.contactId);
      out.push({ runId: r._id, error: r.error ?? "unknown", at: r.endedAt ?? r._creationTime, contact: contact?.username ?? contact?.name ?? contact?.igsid });
    }
    return out;
  },
});

export const failedEvents = orgAdminQuery({
  args: {},
  handler: async (ctx) => {
    // Org first, then the limit: other tenants' traffic can never push this workspace's failures out of the window.
    const rows = await ctx.db.query("webhookEvents").withIndex("by_org_receivedAt", (q) => q.eq("orgId", ctx.orgId)).order("desc").take(300);
    return rows.filter((e) => e.error).slice(0, 50).map((e) => ({ type: e.type, error: e.error, at: e.receivedAt }));
  },
});

export const EVENT_RETENTION_MS = 30 * 24 * 3600_000;
export const RUN_RETENTION_MS = 90 * 24 * 3600_000;
const BATCH = 200;

/** Daily: drop old webhook payloads (they hold user text) and finished runs. Reschedules itself while work remains. */
export const retentionCleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const events = await ctx.db.query("webhookEvents").withIndex("by_receivedAt", (q) => q.lt("receivedAt", now - EVENT_RETENTION_MS)).take(BATCH);
    for (const e of events) await ctx.db.delete(e._id);
    let runsDeleted = 0;
    const oldRuns = await ctx.db.query("flowRuns").withIndex("by_endedAt", (q) => q.gt("endedAt", 0).lt("endedAt", now - RUN_RETENTION_MS)).take(BATCH);
    for (const r of oldRuns) { await ctx.db.delete(r._id); runsDeleted++; }
    const more = events.length === BATCH || oldRuns.length === BATCH;
    if (more) await ctx.scheduler.runAfter(1000, internal.admin.retentionCleanup, {});
    return { events: events.length, runs: runsDeleted, more };
  },
});

