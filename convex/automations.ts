import { v } from "convex/values";
import { buildGraph, TEMPLATE_TRIGGER, templateConfigSchema } from "./engine/templates";
import { orgAdminMutation, orgQuery } from "./lib/tenancy";

/**
 * Create an automation from a template form: flow + immutable version (graph) + trigger.
 * `template` is validated (zod) and compiled to a graph (validateGraph) before anything is written.
 */
export const create = orgAdminMutation({
  args: {
    igAccountId: v.id("igAccounts"),
    name: v.string(),
    template: v.any(),
    /** keyword triggers: words to match; comment triggers: optional words. */
    keywords: v.optional(v.array(v.string())),
    match: v.optional(v.union(v.literal("exact"), v.literal("contains"))),
    /** comment triggers: restrict to these media ids (empty/undefined = any post). */
    mediaIds: v.optional(v.array(v.string())),
    priority: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.igAccountId);
    if (!account || account.orgId !== ctx.orgId) throw new Error("Instagram account not found");

    const parsed = templateConfigSchema.safeParse(args.template);
    if (!parsed.success) throw new Error(`Invalid template: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    const cfg = parsed.data;
    const triggerType = TEMPLATE_TRIGGER[cfg.key];

    const keywords = (args.keywords ?? []).map((k) => k.trim()).filter(Boolean);
    if (triggerType === "keyword" && keywords.length === 0) throw new Error("Keyword automations need at least one keyword");
    const name = args.name.trim();
    if (!name || name.length > 80) throw new Error("Name must be 1-80 characters");

    const graph = buildGraph(cfg); // throws if the template yields an invalid graph

    const flowId = await ctx.db.insert("flows", {
      orgId: ctx.orgId, name, templateKey: cfg.key, templateConfig: cfg, archived: false,
    });
    const versionId = await ctx.db.insert("flowVersions", {
      orgId: ctx.orgId, flowId, version: 1, graph, createdBy: ctx.userId,
    });
    await ctx.db.patch(flowId, { activeVersionId: versionId });

    const triggerId = await ctx.db.insert("triggers", {
      orgId: ctx.orgId,
      igAccountId: args.igAccountId,
      type: triggerType,
      config: {
        ...(keywords.length ? { keywords } : {}),
        ...(triggerType === "keyword" || triggerType === "comment" ? { match: args.match ?? "contains" } : {}),
        ...(args.mediaIds?.length ? { mediaIds: args.mediaIds } : {}),
      },
      flowId,
      enabled: true,
      priority: args.priority ?? 0,
      firedCount: 0,
    });
    return { flowId, triggerId };
  },
});

export const list = orgQuery({
  args: {},
  handler: async (ctx) => {
    const triggers = await ctx.db.query("triggers").withIndex("by_org", (q) => q.eq("orgId", ctx.orgId)).collect();
    const out = [];
    for (const t of triggers) {
      const flow = await ctx.db.get(t.flowId);
      if (!flow || flow.archived) continue;
      out.push({
        triggerId: t._id, flowId: flow._id, name: flow.name, templateKey: flow.templateKey,
        type: t.type, config: t.config, enabled: t.enabled, priority: t.priority,
        firedCount: t.firedCount, igAccountId: t.igAccountId,
      });
    }
    return out;
  },
});

export const setEnabled = orgAdminMutation({
  args: { triggerId: v.id("triggers"), enabled: v.boolean() },
  handler: async (ctx, { triggerId, enabled }) => {
    const t = await ctx.db.get(triggerId);
    if (!t || t.orgId !== ctx.orgId) throw new Error("Automation not found");
    await ctx.db.patch(triggerId, { enabled });
  },
});

export const remove = orgAdminMutation({
  args: { triggerId: v.id("triggers") },
  handler: async (ctx, { triggerId }) => {
    const t = await ctx.db.get(triggerId);
    if (!t || t.orgId !== ctx.orgId) throw new Error("Automation not found");
    await ctx.db.delete(triggerId);
    await ctx.db.patch(t.flowId, { archived: true }); // keep flow + versions for run history
  },
});
