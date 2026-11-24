import { describe, expect, it } from "vitest";
import { validateGraph, type Graph } from "../convex/engine/graph";
import { buildGraph } from "../convex/engine/templates";
import { BLOCKS, autoLayout, fromFlow, newNode, portsOf, problems, toFlow, type BlockType } from "../src/lib/flow";

const TYPES = Object.keys(BLOCKS) as BlockType[];

describe("flow editor helpers", () => {
  it("every new block passes the node schema and exposes the expected ports", () => {
    for (const t of TYPES) {
      const node = newNode(t);
      const g = { startNodeId: node.id, nodes: [node], edges: [] };
      const r = validateGraph(g);
      // filter needs both branches; everything else is valid alone
      if (t === "filter") expect(r.ok).toBe(false); else expect(r.ok, t).toBe(true);
    }
    expect(portsOf(newNode("filter"))).toEqual(["yes", "no"]);
    expect(portsOf(newNode("quickReplies"))).toEqual(["precios", "horarios", "next"]);
    expect(portsOf(newNode("handoff"))).toEqual([]);
  });

  it("round-trips a template graph through React Flow without changes", () => {
    const graph = buildGraph({ key: "defaultReply", fallbackText: "Pronto", ai: { instructions: "Ayuda" } }) as Graph;
    const { nodes, edges } = toFlow(graph, null);
    const back = fromFlow(nodes, edges).graph;
    expect(back.startNodeId).toBe(graph.startNodeId);
    expect(back.nodes).toEqual(graph.nodes);
    expect([...back.edges].sort((a, b) => (a.from + a.port).localeCompare(b.from + b.port))).toEqual([...graph.edges].sort((a, b) => (a.from + a.port).localeCompare(b.from + b.port)));
  });

  it("auto layout gives every block a distinct position, left to right", () => {
    const graph = buildGraph({ key: "defaultReply", fallbackText: "Pronto", ai: { instructions: "Ayuda" } }) as Graph;
    const layout = autoLayout(graph);
    expect(Object.keys(layout).sort()).toEqual(graph.nodes.map((n) => n.id).sort());
    const start = layout[graph.startNodeId];
    for (const e of graph.edges.filter((x) => x.from === graph.startNodeId)) expect(layout[e.to].x).toBeGreaterThan(start.x);
  });

  it("explains graph problems in plain Spanish", () => {
    const filter = newNode("filter");
    const msg = newNode("message");
    const msgs = problems({ startNodeId: msg.id, nodes: [msg, filter], edges: [] });
    expect(msgs.join(" ")).toContain("necesita una salida «Sí» y otra «No»");
    expect(msgs.join(" ")).toContain("no está conectado al inicio");
    expect(problems({ startNodeId: "x", nodes: [], edges: [] })).toEqual(["Añade al menos un bloque."]);
    expect(problems({ startNodeId: msg.id, nodes: [msg], edges: [] })).toEqual([]);
  });
});
