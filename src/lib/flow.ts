/**
 * Bridge between the stored flow graph ({ startNodeId, nodes, edges: { from, port, to } }) and React Flow.
 * The stored format stays the source of truth; React Flow nodes carry the graph node in `data.node`.
 */
import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import { PORTS, validateGraph, type Graph, type GraphNode } from "../../convex/engine/graph";

export type BlockType = GraphNode["type"];
export type FlowNode = Node<{ node: GraphNode; isStart: boolean }, "block">;
export type FlowEdge = Edge;
export type Layout = Record<string, { x: number; y: number }>;

export const NODE_WIDTH = 264;

export const BLOCKS: Record<BlockType, { label: string; hint: string; color: string }> = {
  message: { label: "Mensaje", hint: "Envía un texto.", color: "var(--color-blk-message)" },
  quickReplies: { label: "Opciones rápidas", hint: "Pregunta y muestra botones de respuesta.", color: "var(--color-blk-ask)" },
  filter: { label: "Filtro", hint: "Divide el camino según una condición.", color: "var(--color-blk-filter)" },
  aiAgent: { label: "Agente de IA", hint: "La IA conversa con el cliente.", color: "var(--color-blk-ai)" },
  action: { label: "Acción", hint: "Etiqueta, guarda un dato o llama a una URL.", color: "var(--color-blk-action)" },
  wait: { label: "Espera", hint: "Pausa antes del siguiente paso.", color: "var(--color-blk-wait)" },
  waitForReply: { label: "Esperar respuesta", hint: "Espera a que el cliente escriba.", color: "var(--color-blk-ask)" },
  handoff: { label: "Pasar a una persona", hint: "Termina el bot y avisa al equipo.", color: "var(--color-blk-handoff)" },
};

const PORT_LABEL: Record<string, string> = {
  next: "Siguiente", yes: "Sí", no: "No", exit: "Termina", timeout: "Sin respuesta a tiempo", quota: "Sin cuota de IA",
};
export const portLabel = (node: GraphNode, port: string): string => {
  if (node.type === "quickReplies") {
    const o = node.options.find((x) => x.payload === port);
    if (o) return o.title;
    if (port === "next") return "Otra respuesta";
  }
  if (node.type === "aiAgent" && port === "exit") return "La IA termina";
  if (node.type === "aiAgent" && port === "timeout") return "Sin respuesta a tiempo";
  return PORT_LABEL[port] ?? port;
};

/** Output ports a block exposes in the editor, in display order. */
export function portsOf(node: GraphNode): string[] {
  if (node.type === "quickReplies") return [...node.options.map((o) => o.payload), "next"];
  return PORTS[node.type];
}

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter}`;
}

export function newNode(type: BlockType): GraphNode {
  const id = newId(type);
  switch (type) {
    case "message": return { id, type, text: "Hola {{first_name}}, ¿en qué te ayudo?" };
    case "quickReplies": return { id, type, text: "¿Qué necesitas?", options: [{ title: "Precios", payload: "precios" }, { title: "Horarios", payload: "horarios" }] };
    case "filter": return { id, type, mode: "all", conditions: [{ kind: "businessHours" }] };
    case "aiAgent": return { id, type, instructions: "Responde con amabilidad y brevedad usando la información del negocio.", exitWhen: "", timeoutMinutes: 60, useKnowledge: true };
    case "action": return { id, type, actions: [{ kind: "addTag", tag: "interesado" }] };
    case "wait": return { id, type, minutes: 5 };
    case "waitForReply": return { id, type, timeoutMinutes: 60 };
    case "handoff": return { id, type, message: "" };
  }
}

/** One-line description shown inside a block. */
export function summarize(node: GraphNode): string {
  switch (node.type) {
    case "message": return node.text;
    case "quickReplies": return node.text;
    case "filter": return node.conditions.map(conditionLabel).join(node.mode === "all" ? " y " : " o ");
    case "aiAgent": return node.instructions || "Sin instrucciones";
    case "action": return node.actions.map(actionLabel).join(", ");
    case "wait": return `Espera ${node.minutes} min`;
    case "waitForReply": return `Hasta ${node.timeoutMinutes} min${node.saveAs ? `, guarda en «${node.saveAs}»` : ""}`;
    case "handoff": return node.message || "Una persona toma la conversación";
  }
}

export function conditionLabel(c: Extract<GraphNode, { type: "filter" }>["conditions"][number]): string {
  switch (c.kind) {
    case "businessHours": return "Dentro del horario";
    case "aiQuotaAvailable": return "Hay cuota de IA";
    case "hasTag": return `Tiene la etiqueta «${c.tag}»`;
    case "field": return `${c.key} ${c.op === "eq" ? "es" : c.op === "neq" ? "no es" : "contiene"} «${c.value}»`;
  }
}

export function actionLabel(a: Extract<GraphNode, { type: "action" }>["actions"][number]): string {
  switch (a.kind) {
    case "addTag": return `Etiqueta «${a.tag}»`;
    case "setField": return `${a.key} = «${a.value}»`;
    case "note": return `Nota: ${a.text}`;
    case "http": return `${a.method} ${a.url}`;
  }
}

function blockHeight(node: GraphNode): number {
  return 92 + portsOf(node).length * 26;
}

/** Positions blocks left to right with dagre. */
export function autoLayout(graph: Graph): Layout {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 36, ranksep: 90, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of graph.nodes) g.setNode(n.id, { width: NODE_WIDTH, height: blockHeight(n) });
  for (const e of graph.edges) g.setEdge(e.from, e.to);
  dagre.layout(g);
  const out: Layout = {};
  for (const n of graph.nodes) {
    const p = g.node(n.id);
    out[n.id] = { x: p.x - NODE_WIDTH / 2, y: p.y - blockHeight(n) / 2 };
  }
  return out;
}

export function toFlow(graph: Graph, layout?: Layout | null): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const pos = layout && graph.nodes.every((n) => layout[n.id]) ? layout : autoLayout(graph);
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id, type: "block" as const, position: pos[n.id], data: { node: n, isStart: n.id === graph.startNodeId },
    })),
    edges: graph.edges.map((e) => edgeOf(e.from, e.port, e.to)),
  };
}

export const edgeOf = (from: string, port: string, to: string): FlowEdge => ({
  id: `${from}:${port}`, source: from, sourceHandle: port, target: to, type: "smoothstep",
});

export function fromFlow(nodes: FlowNode[], edges: FlowEdge[]): { graph: Graph; layout: Layout } {
  const start = nodes.find((n) => n.data.isStart) ?? nodes[0];
  const layout: Layout = {};
  for (const n of nodes) layout[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
  return {
    graph: {
      startNodeId: start?.id ?? "",
      nodes: nodes.map((n) => n.data.node),
      edges: edges.filter((e) => e.sourceHandle).map((e) => ({ from: e.source, port: e.sourceHandle as string, to: e.target })),
    },
    layout,
  };
}

/** Problems with the current drawing, in plain Spanish. Empty = can be saved. */
export function problems(graph: Graph): string[] {
  if (graph.nodes.length === 0) return ["Añade al menos un bloque."];
  const r = validateGraph(graph);
  if (r.ok) return [];
  return r.errors.map((raw) => {
    const find = (re: RegExp) => raw.match(re)?.[1];
    const label = (id?: string) => {
      const n = graph.nodes.find((x) => x.id === id);
      return n ? BLOCKS[n.type].label : "Un bloque";
    };
    if (raw.includes("is unreachable")) return `«${label(find(/node "([^"]+)"/))}» no está conectado al inicio.`;
    if (raw.includes("needs both")) return `«${label(find(/filter "([^"]+)"/))}» necesita una salida «Sí» y otra «No».`;
    if (raw.includes("two edges")) return "Un mismo botón de salida no puede ir a dos bloques.";
    if (raw.includes("text")) return "Hay un bloque con el texto vacío o demasiado largo.";
    return raw;
  });
}

/** Variables the message text may use; inserted with the picker. */
export const VARIABLES = [
  { key: "first_name", label: "Nombre" },
  { key: "full_name", label: "Nombre completo" },
  { key: "username", label: "Usuario" },
] as const;
