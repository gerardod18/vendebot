import { v } from "convex/values";
import { channelProblems, validateGraph, type Graph } from "./engine/graph";
import { libraryById } from "./engine/library";
import { buildGraph, TEMPLATE_TRIGGER, templateConfigSchema } from "./engine/templates";
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { channelOf } from "./lib/accounts";
import { orgAdminMutation, orgQuery } from "./lib/tenancy";

/**
 * Rejects what a channel cannot do: comment / story-mention triggers do not exist on WhatsApp, and a quick-reply
 * block with more than 10 options cannot be sent there. The message is shown as-is in the editor.
 */
function assertChannelFit(account: Doc<"igAccounts">, triggerType: Doc<"triggers">["type"], graph?: Graph) {
  const channel = channelOf(account);
  if (channel === "whatsapp" && (triggerType === "comment" || triggerType === "storyMention")) {
    throw new Error("Las automatizaciones de comentarios y menciones en historias solo existen en Instagram, no en WhatsApp");
  }
  const [first] = graph ? channelProblems(graph, channel) : [];
  if (first) throw new Error(first);
}

type TriggerFields = {
  keywords?: string[];
  match?: "exact" | "contains";
  mediaIds?: string[];
  publicReply?: string;
};

/** Builds and checks the trigger config for a trigger type from the form values. */
function buildTriggerConfig(triggerType: Doc<"triggers">["type"], a: TriggerFields) {
  const keywords = (a.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  if (triggerType === "keyword" && keywords.length === 0) throw new Error("Keyword automations need at least one keyword");
  return {
    ...(keywords.length ? { keywords } : {}),
    ...(triggerType === "keyword" || triggerType === "comment" ? { match: a.match ?? "contains" } : {}),
    ...(a.mediaIds?.length ? { mediaIds: a.mediaIds } : {}),
    ...(triggerType === "comment" && a.publicReply?.trim() ? { publicReply: a.publicReply.trim().slice(0, 300) } : {}),
  };
}

function checkName(raw: string) {
  const name = raw.trim();
  if (!name || name.length > 80) throw new Error("Name must be 1-80 characters");
  return name;
}

/** Loads a trigger of this workspace, its flow and its (same-workspace) account, or throws. */
async function loadOwned(ctx: MutationCtx & { orgId: Doc<"orgs">["_id"] }, triggerId: Doc<"triggers">["_id"]) {
  const trigger = await ctx.db.get(triggerId);
  if (!trigger || trigger.orgId !== ctx.orgId) throw new Error("Automation not found");
  const flow = await ctx.db.get(trigger.flowId);
  if (!flow || flow.orgId !== ctx.orgId || flow.archived) throw new Error("Automation not found");
  const account = await ctx.db.get(trigger.igAccountId);
  if (!account || account.orgId !== ctx.orgId) throw new Error("Automation not found");
  return { trigger, flow, account };
}

/** Rejects an edit made on top of a version that is no longer the active one (two people editing, or a stale tab). */
async function assertFresh(ctx: MutationCtx, flow: Doc<"flows">, expectedVersion: number | undefined) {
  if (expectedVersion === undefined) return;
  const active = flow.activeVersionId ? await ctx.db.get(flow.activeVersionId) : null;
  if ((active?.version ?? 0) !== expectedVersion) {
    throw new Error("Esta automatización cambió mientras la editabas. Recarga para ver la última versión y vuelve a aplicar tus cambios.");
  }
}

/** Appends a new immutable version and makes it the active one. */
async function publishVersion(ctx: MutationCtx, flow: Doc<"flows">, userId: string, graph: unknown, layout?: unknown) {
  const last = await ctx.db.query("flowVersions").withIndex("by_flow", (q) => q.eq("flowId", flow._id)).order("desc").first();
  const versionId = await ctx.db.insert("flowVersions", {
    orgId: flow.orgId, flowId: flow._id, version: (last?.version ?? 0) + 1, graph, ...(layout ? { layout } : {}), createdBy: userId,
  });
  return versionId;
}

/** Cancels every run still waiting or running on any version of this flow, so its timers send nothing after deletion. */
async function cancelFlowRuns(ctx: MutationCtx, flowId: Doc<"flows">["_id"]) {
  const versions = await ctx.db.query("flowVersions").withIndex("by_flow", (q) => q.eq("flowId", flowId)).take(500);
  for (const ver of versions) {
    for (const status of ["waiting", "running"] as const) {
      const runs = await ctx.db.query("flowRuns").withIndex("by_flowVersion_status", (q) => q.eq("flowVersionId", ver._id).eq("status", status)).take(500);
      for (const r of runs) await ctx.db.patch(r._id, { status: "cancelled", endedAt: Date.now(), waitingFor: undefined });
    }
  }
}

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
    /** comment triggers: public reply posted under the comment. */
    publicReply: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.igAccountId);
    if (!account || account.orgId !== ctx.orgId) throw new Error("Instagram account not found");

    const parsed = templateConfigSchema.safeParse(args.template);
    if (!parsed.success) throw new Error(`Invalid template: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    const cfg = parsed.data;
    const triggerType = TEMPLATE_TRIGGER[cfg.key];

    const triggerConfig = buildTriggerConfig(triggerType, args);
    const name = checkName(args.name);

    const graph = buildGraph(cfg); // throws if the template yields an invalid graph
    assertChannelFit(account, triggerType, graph);

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
      config: triggerConfig,
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
        firedCount: t.firedCount, igAccountId: t.igAccountId, editableAsForm: Boolean(flow.templateConfig),
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
    if (enabled) {
      // Only a live account of this same workspace may fire it: a disconnected account (or one that drifted to
      // another workspace) must not be revivable through its old triggers.
      const account = await ctx.db.get(t.igAccountId);
      if (!account || account.orgId !== ctx.orgId) throw new Error("Automation not found");
      if (account.status !== "active") throw new Error("Reconecta la cuenta antes de activar esta automatización");
    }
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
    await cancelFlowRuns(ctx, t.flowId); // timers of waiting runs must not keep sending after deletion
  },
});

/** Everything the editor needs: flow, trigger, the active graph and its block layout. */
export const get = orgQuery({
  args: { triggerId: v.id("triggers") },
  handler: async (ctx, { triggerId }) => {
    const trigger = await ctx.db.get(triggerId);
    if (!trigger || trigger.orgId !== ctx.orgId) return null;
    const flow = await ctx.db.get(trigger.flowId);
    if (!flow || flow.orgId !== ctx.orgId || flow.archived) return null;
    const version = flow.activeVersionId ? await ctx.db.get(flow.activeVersionId) : null;
    return {
      triggerId, flowId: flow._id, name: flow.name, templateKey: flow.templateKey ?? null,
      templateConfig: flow.templateConfig ?? null, type: trigger.type, config: trigger.config, enabled: trigger.enabled,
      igAccountId: trigger.igAccountId, firedCount: trigger.firedCount,
      graph: version?.graph ?? null, layout: version?.layout ?? null, version: version?.version ?? 0,
    };
  },
});

/** Edit an automation built from a template form: rebuilds the graph as a new version. */
export const update = orgAdminMutation({
  args: {
    triggerId: v.id("triggers"),
    name: v.string(),
    template: v.any(),
    keywords: v.optional(v.array(v.string())),
    match: v.optional(v.union(v.literal("exact"), v.literal("contains"))),
    mediaIds: v.optional(v.array(v.string())),
    publicReply: v.optional(v.string()),
    /** The version number the form was loaded from; a different active version means a stale edit. */
    expectedVersion: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { trigger, flow, account } = await loadOwned(ctx, args.triggerId);
    await assertFresh(ctx, flow, args.expectedVersion);
    if (!flow.templateConfig) throw new Error("This automation was edited in the flow editor; edit it there");
    const parsed = templateConfigSchema.safeParse(args.template);
    if (!parsed.success) throw new Error(`Invalid template: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
    if (TEMPLATE_TRIGGER[parsed.data.key] !== trigger.type) throw new Error("The automation type cannot be changed");
    const config = buildTriggerConfig(trigger.type, args);
    const name = checkName(args.name);
    const graph = buildGraph(parsed.data);
    assertChannelFit(account, trigger.type, graph);
    const versionId = await publishVersion(ctx, flow, ctx.userId, graph);
    await ctx.db.patch(flow._id, { name, templateConfig: parsed.data, activeVersionId: versionId });
    await ctx.db.patch(trigger._id, { config });
  },
});

/** Rename and change trigger settings (keywords, match, posts, public reply) of any automation. */
export const updateTrigger = orgAdminMutation({
  args: {
    triggerId: v.id("triggers"),
    name: v.string(),
    keywords: v.optional(v.array(v.string())),
    match: v.optional(v.union(v.literal("exact"), v.literal("contains"))),
    mediaIds: v.optional(v.array(v.string())),
    publicReply: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { trigger, flow, account } = await loadOwned(ctx, args.triggerId);
    assertChannelFit(account, trigger.type);
    await ctx.db.patch(flow._id, { name: checkName(args.name) });
    await ctx.db.patch(trigger._id, { config: buildTriggerConfig(trigger.type, args) });
  },
});

/**
 * Save a graph drawn in the flow editor as a new version. The graph is validated with the same rules the
 * runner relies on; once saved this way the automation is no longer described by its template form.
 */
export const saveGraph = orgAdminMutation({
  args: { triggerId: v.id("triggers"), graph: v.any(), layout: v.optional(v.any()), expectedVersion: v.optional(v.number()) },
  handler: async (ctx, { triggerId, graph, layout, expectedVersion }) => {
    const { trigger, flow, account } = await loadOwned(ctx, triggerId);
    await assertFresh(ctx, flow, expectedVersion);
    // validateGraph parses with the strict node schema, so unknown keys (e.g. a per-node AI `model`) are dropped.
    const checked = validateGraph(graph);
    if (!checked.ok) throw new Error(`Invalid flow: ${checked.errors.slice(0, 3).join("; ")}`);
    assertChannelFit(account, trigger.type, checked.graph);
    const versionId = await publishVersion(ctx, flow, ctx.userId, checked.graph, layout);
    await ctx.db.patch(flow._id, { activeVersionId: versionId, templateConfig: undefined });
    return { version: (await ctx.db.get(versionId))!.version };
  },
});

/** Create an automation from a ready-made sales flow (see engine/library.ts). The graph is validated like any other. */
export const createFromLibrary = orgAdminMutation({
  args: { libraryId: v.string(), igAccountId: v.id("igAccounts"), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.igAccountId);
    if (!account || account.orgId !== ctx.orgId) throw new Error("Instagram account not found");
    const lib = libraryById(args.libraryId);
    if (!lib) throw new Error("Unknown flow");
    const channel = account.channel ?? "instagram";
    if (!lib.channels.includes(channel)) throw new Error("This flow is not available for that channel");
    const checked = validateGraph(lib.graph);
    if (!checked.ok) throw new Error(`Invalid flow: ${checked.errors.slice(0, 3).join("; ")}`);
    assertChannelFit(account, lib.trigger.type, checked.graph);
    const name = checkName(args.name?.trim() || lib.title);
    const config = buildTriggerConfig(lib.trigger.type, lib.trigger);

    const flowId = await ctx.db.insert("flows", { orgId: ctx.orgId, name, archived: false });
    const versionId = await ctx.db.insert("flowVersions", { orgId: ctx.orgId, flowId, version: 1, graph: checked.graph, createdBy: ctx.userId });
    await ctx.db.patch(flowId, { activeVersionId: versionId });
    const triggerId = await ctx.db.insert("triggers", {
      orgId: ctx.orgId, igAccountId: args.igAccountId, type: lib.trigger.type, config, flowId, enabled: true, priority: 0, firedCount: 0,
    });
    return { flowId, triggerId };
  },
});
