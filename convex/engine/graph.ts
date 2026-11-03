/** Flow graph format (docs/ARCHITECTURE.md §5) + validation. Pure; no Convex imports. */
import { z } from "zod";

const id = z.string().min(1).max(64);

const quickReply = z.object({ title: z.string().min(1).max(20), payload: z.string().min(1).max(200) });

export const conditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("businessHours") }),
  z.object({ kind: z.literal("aiQuotaAvailable") }),
  z.object({ kind: z.literal("hasTag"), tag: z.string().min(1) }),
  z.object({
    kind: z.literal("field"),
    key: z.string().min(1),
    op: z.enum(["eq", "neq", "contains"]),
    value: z.string(),
  }),
]);

export const actionItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("addTag"), tag: z.string().min(1) }),
  z.object({ kind: z.literal("setField"), key: z.string().min(1), value: z.string() }),
  z.object({ kind: z.literal("note"), text: z.string().min(1) }),
  z.object({
    kind: z.literal("http"),
    url: z.string().url(),
    method: z.enum(["GET", "POST"]).default("POST"),
    body: z.string().optional(),
  }),
]);

export const nodeSchema = z.discriminatedUnion("type", [
  z.object({ id, type: z.literal("message"), text: z.string().min(1).max(1000) }),
  z.object({
    id,
    type: z.literal("quickReplies"),
    text: z.string().min(1).max(1000),
    options: z.array(quickReply).min(1).max(13),
  }),
  z.object({
    id,
    type: z.literal("filter"),
    mode: z.enum(["all", "any"]),
    conditions: z.array(conditionSchema).min(1),
  }),
  z.object({
    id,
    type: z.literal("aiAgent"),
    instructions: z.string().max(4000),
    exitWhen: z.string().max(500).default(""),
    timeoutMinutes: z.number().int().min(1).max(60 * 24 * 7).default(60),
    useKnowledge: z.boolean().default(true),
    model: z.string().optional(),
  }),
  z.object({ id, type: z.literal("action"), actions: z.array(actionItemSchema).min(1).max(10) }),
  z.object({ id, type: z.literal("wait"), minutes: z.number().int().min(1).max(60 * 24 * 7) }),
  z.object({
    id,
    type: z.literal("waitForReply"),
    timeoutMinutes: z.number().int().min(1).max(60 * 24 * 7),
    saveAs: z.string().min(1).optional(),
  }),
  z.object({ id, type: z.literal("handoff"), message: z.string().max(1000).optional() }),
]);

export const edgeSchema = z.object({ from: id, port: z.string().min(1).max(200), to: id });

export const graphSchema = z.object({
  startNodeId: id,
  nodes: z.array(nodeSchema).min(1).max(100),
  edges: z.array(edgeSchema).max(300),
});

export type Graph = z.infer<typeof graphSchema>;
export type GraphNode = z.infer<typeof nodeSchema>;
export type Condition = z.infer<typeof conditionSchema>;
export type ActionItem = z.infer<typeof actionItemSchema>;

/** Output ports each node type may use. `waitForReply`/`quickReplies` also allow payload-named ports. */
export const PORTS: Record<GraphNode["type"], string[]> = {
  message: ["next"],
  quickReplies: ["next"], // plus one port per option payload
  filter: ["yes", "no"],
  aiAgent: ["exit", "timeout", "quota"],
  action: ["next"],
  wait: ["next"],
  waitForReply: ["next", "timeout"],
  handoff: [],
};

/** Returns a list of problems (empty = valid). Never throws. */
export function validateGraph(input: unknown): { ok: true; graph: Graph } | { ok: false; errors: string[] } {
  const parsed = graphSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "graph"}: ${i.message}`) };
  }
  const graph = parsed.data;
  const errors: string[] = [];
  const nodes = new Map<string, GraphNode>();
  for (const n of graph.nodes) {
    if (nodes.has(n.id)) errors.push(`duplicate node id "${n.id}"`);
    nodes.set(n.id, n);
  }
  if (!nodes.has(graph.startNodeId)) errors.push(`startNodeId "${graph.startNodeId}" is not a node`);

  const seenPorts = new Set<string>();
  for (const e of graph.edges) {
    const from = nodes.get(e.from);
    if (!from) { errors.push(`edge from unknown node "${e.from}"`); continue; }
    if (!nodes.has(e.to)) errors.push(`edge to unknown node "${e.to}"`);
    const key = `${e.from}:${e.port}`;
    if (seenPorts.has(key)) errors.push(`node "${e.from}" has two edges on port "${e.port}"`);
    seenPorts.add(key);
    const allowed = PORTS[from.type];
    const payloadPort =
      (from.type === "quickReplies" && from.options.some((o) => o.payload === e.port)) ||
      from.type === "waitForReply"; // free-form payload ports allowed
    if (!allowed.includes(e.port) && !payloadPort) {
      errors.push(`node "${e.from}" (${from.type}) has no port "${e.port}"`);
    }
  }
  for (const n of graph.nodes) {
    if (n.type === "filter" && !(seenPorts.has(`${n.id}:yes`) && seenPorts.has(`${n.id}:no`))) {
      errors.push(`filter "${n.id}" needs both "yes" and "no" edges`);
    }
  }
  // Reachability from start (unreachable nodes are an error: they are dead config).
  if (nodes.has(graph.startNodeId)) {
    const adj = new Map<string, string[]>();
    for (const e of graph.edges) adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
    const seen = new Set<string>([graph.startNodeId]);
    const stack = [graph.startNodeId];
    while (stack.length) for (const nx of adj.get(stack.pop()!) ?? []) if (!seen.has(nx)) { seen.add(nx); stack.push(nx); }
    for (const n of graph.nodes) if (!seen.has(n.id)) errors.push(`node "${n.id}" is unreachable`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, graph };
}
