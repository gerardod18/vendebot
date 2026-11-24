import { Handle, Position, type NodeProps } from "@xyflow/react";
import { BLOCKS, portLabel, portsOf, summarize, type FlowNode } from "../../lib/flow";

/** One block of the flow. The colored top edge encodes the block type; each output port is a labelled handle. */
export function FlowBlock({ data }: NodeProps<FlowNode>) {
  const { node, isStart } = data;
  const meta = BLOCKS[node.type];
  const ports = portsOf(node);
  return (
    <div className="flow-block w-[264px] rounded-lg border border-line bg-surface shadow-sm" style={{ borderTop: `4px solid ${meta.color}` }}>
      <Handle type="target" position={Position.Left} id="in" aria-label="Entrada" />
      <div className="px-3 pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold" style={{ color: meta.color }}>{meta.label}</p>
          {isStart && <span className="rounded-full bg-ok-wash px-2 py-0.5 text-xs font-medium text-ok">Inicio</span>}
        </div>
        <p className="mt-1 line-clamp-3 min-h-[2.5rem] whitespace-pre-wrap break-words text-sm text-ink-soft">{summarize(node)}</p>
      </div>
      {ports.length > 0 && (
        <ul className="mt-2 border-t border-line">
          {ports.map((p) => (
            <li key={p} className="relative flex h-[26px] items-center justify-end px-3 text-xs text-ink-soft">
              {portLabel(node, p)}
              <Handle type="source" position={Position.Right} id={p} aria-label={portLabel(node, p)} />
            </li>
          ))}
        </ul>
      )}
      {ports.length === 0 && <p className="mt-2 border-t border-line px-3 py-1.5 text-xs text-ink-faint">Fin del flujo</p>}
    </div>
  );
}
