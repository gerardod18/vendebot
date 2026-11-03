/**
 * Pure flow interpreter: a state machine over a validated Graph.
 * It performs NO I/O. It returns the effects (`actions`) the caller must execute (send DM, tag, call AI...),
 * and the new `state`. The Convex Workflow wrapper (Phase 4 next step) executes actions durably and
 * calls `step()` again with the resume input. This keeps all branching logic unit-testable.
 */
import type { ActionItem, Condition, Graph, GraphNode } from "./graph";

export type RunState = {
  status: "running" | "waiting" | "done" | "failed";
  nodeId: string | null; // node we are at / waiting on
  waitingFor?: "reply" | "ai" | "timer";
  vars: Record<string, string>;
  error?: string;
};

export type RunContext = {
  contact: { name?: string; username?: string; tags: string[]; fields: Record<string, string> };
  inBusinessHours: boolean;
  aiQuotaAvailable: boolean;
};

export type ResumeInput =
  | { kind: "reply"; text?: string; payload?: string }
  | { kind: "timeout" }
  | { kind: "timer" }
  | { kind: "aiExit" }
  | { kind: "aiQuotaExceeded" };

export type Effect =
  | { type: "send"; text: string; quickReplies?: { title: string; payload: string }[] }
  | { type: "addTag"; tag: string }
  | { type: "setField"; key: string; value: string }
  | { type: "note"; text: string }
  | { type: "http"; url: string; method: "GET" | "POST"; body?: string }
  | { type: "handoff"; message?: string }
  | { type: "startAi"; nodeId: string; instructions: string; exitWhen: string; timeoutMinutes: number; useKnowledge: boolean; model?: string }
  | { type: "scheduleTimeout"; minutes: number; reason: "wait" | "reply" | "ai" };

export const MAX_STEPS = 100;

export function initialState(graph: Graph): RunState {
  return { status: "running", nodeId: graph.startNodeId, vars: {} };
}

export function interpolate(text: string, ctx: RunContext, vars: Record<string, string>): string {
  const first = (ctx.contact.name ?? ctx.contact.username ?? "").split(" ")[0];
  const table: Record<string, string> = {
    first_name: first,
    full_name: ctx.contact.name ?? ctx.contact.username ?? "",
    username: ctx.contact.username ?? "",
    ...ctx.contact.fields,
    ...vars,
  };
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => table[k] ?? "").replace(/[ \t]{2,}/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
}

export function evalCondition(c: Condition, ctx: RunContext, vars: Record<string, string>): boolean {
  switch (c.kind) {
    case "businessHours": return ctx.inBusinessHours;
    case "aiQuotaAvailable": return ctx.aiQuotaAvailable;
    case "hasTag": return ctx.contact.tags.includes(c.tag);
    case "field": {
      const v = vars[c.key] ?? ctx.contact.fields[c.key] ?? "";
      if (c.op === "eq") return v === c.value;
      if (c.op === "neq") return v !== c.value;
      return v.toLowerCase().includes(c.value.toLowerCase());
    }
  }
}

function nextNode(graph: Graph, from: string, port: string): string | null {
  return graph.edges.find((e) => e.from === from && e.port === port)?.to ?? null;
}

/**
 * Advance the run. Call with no `input` to start/continue a running state, or with `input` to resume a waiting one.
 * Runs nodes until it must wait for something external, finishes, or fails.
 */
export function step(
  graph: Graph,
  prev: RunState,
  ctx: RunContext,
  input?: ResumeInput,
): { state: RunState; effects: Effect[] } {
  const effects: Effect[] = [];
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  let state: RunState = { ...prev, vars: { ...prev.vars } };
  const fail = (error: string) => ({ state: { ...state, status: "failed" as const, error }, effects });

  if (state.status === "done" || state.status === "failed") return { state, effects };

  // ---- Resume from a wait ----
  if (state.status === "waiting") {
    if (!input) return { state, effects };
    const node = state.nodeId ? nodes.get(state.nodeId) : undefined;
    if (!node) return fail("waiting on unknown node");
    let port: string | null = null;

    if (node.type === "waitForReply" && state.waitingFor === "reply") {
      if (input.kind === "reply") {
        if (node.saveAs && input.text) state.vars[node.saveAs] = input.text;
        port = input.payload && nextNode(graph, node.id, input.payload) ? input.payload : "next";
      } else if (input.kind === "timeout") port = "timeout";
    } else if (node.type === "quickReplies" && state.waitingFor === "reply") {
      if (input.kind === "reply") {
        port = input.payload && nextNode(graph, node.id, input.payload) ? input.payload : "next";
      }
    } else if (node.type === "wait" && state.waitingFor === "timer" && input.kind === "timer") {
      port = "next";
    } else if (node.type === "aiAgent" && state.waitingFor === "ai") {
      if (input.kind === "aiExit") port = "exit";
      else if (input.kind === "timeout") port = "timeout";
      else if (input.kind === "aiQuotaExceeded") port = "quota";
    }
    if (port === null) return { state, effects }; // input not applicable to this wait: stay put
    const to = nextNode(graph, node.id, port);
    state = { ...state, status: "running", waitingFor: undefined, nodeId: to };
    if (!to) return { state: { ...state, status: "done", nodeId: null }, effects };
  }

  // ---- Run nodes ----
  for (let steps = 0; steps < MAX_STEPS; steps++) {
    if (!state.nodeId) return { state: { ...state, status: "done", nodeId: null }, effects };
    const node: GraphNode | undefined = nodes.get(state.nodeId);
    if (!node) return fail(`unknown node "${state.nodeId}"`);

    const go = (port: string) => { state = { ...state, nodeId: nextNode(graph, node.id, port) }; };

    switch (node.type) {
      case "message":
        effects.push({ type: "send", text: interpolate(node.text, ctx, state.vars) });
        go("next");
        break;
      case "quickReplies":
        effects.push({ type: "send", text: interpolate(node.text, ctx, state.vars), quickReplies: node.options });
        state = { ...state, status: "waiting", waitingFor: "reply" };
        return { state, effects };
      case "filter": {
        const results = node.conditions.map((c) => evalCondition(c, ctx, state.vars));
        const pass = node.mode === "all" ? results.every(Boolean) : results.some(Boolean);
        go(pass ? "yes" : "no");
        break;
      }
      case "action":
        for (const a of node.actions as ActionItem[]) {
          if (a.kind === "addTag") effects.push({ type: "addTag", tag: a.tag });
          else if (a.kind === "setField") { state.vars[a.key] = a.value; effects.push({ type: "setField", key: a.key, value: a.value }); }
          else if (a.kind === "note") effects.push({ type: "note", text: interpolate(a.text, ctx, state.vars) });
          else effects.push({ type: "http", url: a.url, method: a.method, body: a.body && interpolate(a.body, ctx, state.vars) });
        }
        go("next");
        break;
      case "wait":
        effects.push({ type: "scheduleTimeout", minutes: node.minutes, reason: "wait" });
        state = { ...state, status: "waiting", waitingFor: "timer" };
        return { state, effects };
      case "waitForReply":
        effects.push({ type: "scheduleTimeout", minutes: node.timeoutMinutes, reason: "reply" });
        state = { ...state, status: "waiting", waitingFor: "reply" };
        return { state, effects };
      case "aiAgent":
        effects.push({
          type: "startAi", nodeId: node.id, instructions: node.instructions, exitWhen: node.exitWhen,
          timeoutMinutes: node.timeoutMinutes, useKnowledge: node.useKnowledge, model: node.model,
        });
        effects.push({ type: "scheduleTimeout", minutes: node.timeoutMinutes, reason: "ai" });
        state = { ...state, status: "waiting", waitingFor: "ai" };
        return { state, effects };
      case "handoff":
        effects.push({ type: "handoff", message: node.message && interpolate(node.message, ctx, state.vars) });
        return { state: { ...state, status: "done", nodeId: null }, effects };
    }
  }
  return fail(`exceeded ${MAX_STEPS} steps (loop?)`);
}
