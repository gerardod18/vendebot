import {
  Background, BackgroundVariant, Controls, MiniMap, ReactFlow, ReactFlowProvider, addEdge, useEdgesState, useNodesState,
  type Connection,
} from "@xyflow/react";
import { useCallback, useMemo, useState } from "react";
import { channelProblems, type Graph, type GraphNode } from "../../../convex/engine/graph";
import {
  BLOCKS, NODE_WIDTH, edgeOf, fromFlow, newNode, portsOf, problems, toFlow, type BlockType, type FlowEdge, type FlowNode, type Layout,
} from "../../lib/flow";
import { Btn, ErrorText } from "../ui";
import { FlowBlock } from "./FlowBlock";
import { Inspector } from "./Inspector";

const nodeTypes = { block: FlowBlock };
const PALETTE: BlockType[] = ["message", "quickReplies", "filter", "aiAgent", "action", "wait", "waitForReply", "handoff"];

type Props = {
  graph: Graph;
  layout: Layout | null;
  editing: boolean;
  saving: boolean;
  error: string | null;
  /** Channel of the automation's account: the editor flags what that channel cannot send (e.g. >10 options on WhatsApp). */
  channel?: "instagram" | "whatsapp";
  onSave: (graph: Graph, layout: Layout) => void;
  onCancel: () => void;
};

export function FlowEditor(props: Props) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}

function Inner({ graph, layout, editing, saving, error, channel = "instagram", onSave, onCancel }: Props) {
  const initial = useMemo(() => toFlow(graph, layout), [graph, layout]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>(initial.edges);
  const [startId, setStartId] = useState(graph.startNodeId);
  const [selected, setSelected] = useState<string | null>(null);

  const effectiveStart = nodes.some((n) => n.id === startId) ? startId : nodes[0]?.id ?? "";
  const display = useMemo(() => nodes.map((n) => ({ ...n, data: { ...n.data, isStart: n.id === effectiveStart } })), [nodes, effectiveStart]);
  const built = useMemo(() => fromFlow(display, edges), [display, edges]);
  const issues = useMemo(() => [...problems(built.graph), ...channelProblems(built.graph, channel)], [built.graph, channel]);
  const current = display.find((n) => n.id === selected) ?? null;

  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || !c.sourceHandle) return;
    // one connection per output port: connecting again replaces the previous one
    setEdges((es) => addEdge(edgeOf(c.source, c.sourceHandle as string, c.target), es.filter((e) => !(e.source === c.source && e.sourceHandle === c.sourceHandle))));
  }, [setEdges]);

  function addBlock(type: BlockType) {
    const node = newNode(type);
    // place to the right of the rightmost block, aligned with the selected one, stacking if the spot is taken
    const anchor = nodes.find((n) => n.id === selected) ?? nodes[nodes.length - 1];
    const right = nodes.reduce((m, n) => Math.max(m, n.position.x), 0);
    const x = nodes.length ? Math.max(right, anchor?.position.x ?? 0) + NODE_WIDTH + 90 : 0;
    const sameColumn = nodes.filter((n) => Math.abs(n.position.x - x) < 40).length;
    const p = { x, y: (anchor?.position.y ?? 0) + sameColumn * 170 };
    setNodes((ns) => [...ns, { id: node.id, type: "block", position: p, data: { node, isStart: false } }]);
    setSelected(node.id);
  }

  function updateNode(next: GraphNode) {
    setNodes((ns) => ns.map((n) => (n.id === next.id ? { ...n, data: { ...n.data, node: next } } : n)));
    const ports = portsOf(next);
    setEdges((es) => es.filter((e) => e.source !== next.id || ports.includes(e.sourceHandle ?? "")));
  }

  function removeBlock(id: string) {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
    setSelected(null);
  }

  return (
    <div className="space-y-3">
      {editing && (
        <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Añadir bloques">
          <span className="text-sm font-medium">Añadir bloque</span>
          {PALETTE.map((t) => (
            <button key={t} type="button" onClick={() => addBlock(t)} title={BLOCKS[t].hint}
              className="rounded-md border border-line-strong bg-surface px-2.5 py-1 text-sm hover:bg-ground" style={{ borderLeft: `4px solid ${BLOCKS[t].color}` }}>
              {BLOCKS[t].label}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="h-[560px] overflow-hidden rounded-lg border border-line bg-surface">
          <ReactFlow
            nodes={display} edges={edges} nodeTypes={nodeTypes}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onNodeClick={(_, n) => setSelected(n.id)} onPaneClick={() => setSelected(null)}
            nodesDraggable={editing} nodesConnectable={editing} edgesReconnectable={false}
            deleteKeyCode={editing ? ["Backspace", "Delete"] : null}
            fitView fitViewOptions={{ padding: 0.2, maxZoom: 1 }} minZoom={0.25} proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1.4} color="var(--color-line-strong)" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable ariaLabel="Mapa del flujo" maskColor="rgba(36, 71, 214, 0.08)" nodeColor={(n) => BLOCKS[(n as FlowNode).data.node.type].color} />
          </ReactFlow>
        </div>

        <div className="space-y-3">
          {editing && current ? (
            <Inspector node={current.data.node} isStart={current.id === effectiveStart}
              onChange={updateNode} onDelete={() => removeBlock(current.id)} onMakeStart={() => setStartId(current.id)} />
          ) : (
            <div className="rounded-lg border border-dashed border-line-strong p-4 text-sm text-ink-soft">
              {editing
                ? "Elige un bloque para editarlo. Arrastra desde el punto de la derecha de un bloque hasta otro para conectarlos."
                : "Así responde esta automatización. Pulsa «Editar flujo» para cambiarla."}
            </div>
          )}
          {editing && issues.length > 0 && (
            <div role="status" className="rounded-md bg-warn-wash p-3 text-sm text-warn">
              <p className="font-medium">Antes de guardar:</p>
              <ul className="mt-1 list-disc pl-5">{issues.map((i) => <li key={i}>{i}</li>)}</ul>
            </div>
          )}
          <ErrorText error={error} />
          {editing && (
            <div className="flex gap-2">
              <Btn disabled={saving || issues.length > 0} onClick={() => onSave(built.graph, built.layout)}>{saving ? "Guardando…" : "Guardar cambios"}</Btn>
              <Btn variant="ghost" onClick={onCancel}>Descartar</Btn>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
