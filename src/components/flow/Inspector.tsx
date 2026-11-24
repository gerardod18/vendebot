import type { GraphNode } from "../../../convex/engine/graph";
import { BLOCKS } from "../../lib/flow";
import { TextWithVars } from "../TextWithVars";
import { Btn, Field, inputCls } from "../ui";

type Cond = Extract<GraphNode, { type: "filter" }>["conditions"][number];
type Act = Extract<GraphNode, { type: "action" }>["actions"][number];

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "opcion";
const num = (v: string, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Side panel to edit the selected block. */
export function Inspector({
  node, isStart, onChange, onDelete, onMakeStart,
}: { node: GraphNode; isStart: boolean; onChange: (n: GraphNode) => void; onDelete: () => void; onMakeStart: () => void }) {
  const meta = BLOCKS[node.type];
  return (
    <aside aria-label="Editar bloque" className="space-y-4 rounded-lg border border-line bg-surface p-4">
      <div>
        <h3 className="text-base font-semibold" style={{ color: meta.color }}>{meta.label}</h3>
        <p className="text-sm text-ink-soft">{meta.hint}</p>
      </div>

      {node.type === "message" && (
        <TextWithVars label="Mensaje" value={node.text} onChange={(text) => onChange({ ...node, text })} maxLength={1000}
          error={node.text.trim() ? null : "Escribe el mensaje."} />
      )}

      {node.type === "quickReplies" && (
        <>
          <TextWithVars label="Pregunta" value={node.text} onChange={(text) => onChange({ ...node, text })} maxLength={1000} error={node.text.trim() ? null : "Escribe la pregunta."} />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Botones</legend>
            <p className="text-xs text-ink-soft">Cada botón abre su propio camino. Máximo 13, de hasta 20 letras.</p>
            {node.options.map((o, i) => (
              <div key={o.payload} className="flex gap-2">
                <input aria-label={`Texto del botón ${i + 1}`} className={inputCls} value={o.title} maxLength={20}
                  onChange={(e) => onChange({ ...node, options: node.options.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                <Btn variant="ghost" aria-label={`Quitar botón ${i + 1}`} disabled={node.options.length <= 1}
                  onClick={() => onChange({ ...node, options: node.options.filter((_, j) => j !== i) })}>Quitar</Btn>
              </div>
            ))}
            <Btn variant="ghost" disabled={node.options.length >= 13}
              onClick={() => {
                const base = `opcion_${node.options.length + 1}`;
                const payload = node.options.some((x) => x.payload === base) ? `${base}_${Date.now() % 1000}` : base;
                onChange({ ...node, options: [...node.options, { title: `Opción ${node.options.length + 1}`, payload }] });
              }}>Añadir botón</Btn>
          </fieldset>
        </>
      )}

      {node.type === "filter" && (
        <>
          <Field label="El camino «Sí» se toma cuando se cumple">
            <select className={inputCls} value={node.mode} onChange={(e) => onChange({ ...node, mode: e.target.value as "all" | "any" })}>
              <option value="all">Todas las condiciones</option>
              <option value="any">Cualquiera de las condiciones</option>
            </select>
          </Field>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Condiciones</legend>
            {node.conditions.map((c, i) => (
              <ConditionRow key={i} c={c} onChange={(nc) => onChange({ ...node, conditions: node.conditions.map((x, j) => (j === i ? nc : x)) })}
                onRemove={node.conditions.length > 1 ? () => onChange({ ...node, conditions: node.conditions.filter((_, j) => j !== i) }) : undefined} />
            ))}
            <Btn variant="ghost" onClick={() => onChange({ ...node, conditions: [...node.conditions, { kind: "hasTag", tag: "" }] })}>Añadir condición</Btn>
          </fieldset>
        </>
      )}

      {node.type === "aiAgent" && (
        <>
          <TextWithVars label="Instrucciones para la IA" hint="Qué debe lograr. Lo que sabe del negocio sale de «Conocimiento»."
            value={node.instructions} onChange={(instructions) => onChange({ ...node, instructions })} rows={5} maxLength={4000} />
          <Field label="Cuándo termina la conversación con la IA" optional hint="Por ejemplo: cuando el cliente deje su teléfono.">
            <input className={inputCls} value={node.exitWhen} maxLength={500} onChange={(e) => onChange({ ...node, exitWhen: e.target.value })} />
          </Field>
          <Field label="Minutos sin respuesta antes de cerrar">
            <input className={inputCls} type="number" min={1} value={node.timeoutMinutes} onChange={(e) => onChange({ ...node, timeoutMinutes: num(e.target.value, 1, 10080, 60) })} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={node.useKnowledge} onChange={(e) => onChange({ ...node, useKnowledge: e.target.checked })} />
            Usar la base de conocimiento
          </label>
        </>
      )}

      {node.type === "action" && (
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Acciones</legend>
          {node.actions.map((a, i) => (
            <ActionRow key={i} a={a} onChange={(na) => onChange({ ...node, actions: node.actions.map((x, j) => (j === i ? na : x)) })}
              onRemove={node.actions.length > 1 ? () => onChange({ ...node, actions: node.actions.filter((_, j) => j !== i) }) : undefined} />
          ))}
          <Btn variant="ghost" disabled={node.actions.length >= 10} onClick={() => onChange({ ...node, actions: [...node.actions, { kind: "addTag", tag: "" }] })}>Añadir acción</Btn>
        </fieldset>
      )}

      {node.type === "wait" && (
        <Field label="Minutos de espera" hint="De 1 minuto a 7 días.">
          <input className={inputCls} type="number" min={1} max={10080} value={node.minutes} onChange={(e) => onChange({ ...node, minutes: num(e.target.value, 1, 10080, 5) })} />
        </Field>
      )}

      {node.type === "waitForReply" && (
        <>
          <Field label="Minutos máximos de espera" hint="Si no responde a tiempo, sigue por «Sin respuesta a tiempo».">
            <input className={inputCls} type="number" min={1} max={10080} value={node.timeoutMinutes} onChange={(e) => onChange({ ...node, timeoutMinutes: num(e.target.value, 1, 10080, 60) })} />
          </Field>
          <Field label="Guardar la respuesta en el dato" optional hint="Ej.: telefono. Luego puedes usarlo como {{telefono}}.">
            <input className={inputCls} value={node.saveAs ?? ""} onChange={(e) => onChange({ ...node, saveAs: slug(e.target.value) === "opcion" && !e.target.value ? undefined : e.target.value.replace(/[^a-zA-Z0-9_]/g, "_") || undefined })} />
          </Field>
        </>
      )}

      {node.type === "handoff" && (
        <TextWithVars label="Mensaje al cliente" optional hint="Se envía antes de pasar la conversación a una persona." value={node.message ?? ""}
          onChange={(message) => onChange({ ...node, message })} maxLength={1000} />
      )}

      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        {!isStart && <Btn variant="ghost" onClick={onMakeStart}>Usar como inicio</Btn>}
        <Btn variant="danger" onClick={onDelete}>Eliminar bloque</Btn>
      </div>
    </aside>
  );
}

function ConditionRow({ c, onChange, onRemove }: { c: Cond; onChange: (c: Cond) => void; onRemove?: () => void }) {
  return (
    <div className="space-y-2 rounded-md border border-line p-2.5">
      <select aria-label="Tipo de condición" className={inputCls} value={c.kind}
        onChange={(e) => {
          const k = e.target.value as Cond["kind"];
          onChange(k === "hasTag" ? { kind: k, tag: "" } : k === "field" ? { kind: k, key: "", op: "eq", value: "" } : { kind: k });
        }}>
        <option value="businessHours">Está dentro del horario de atención</option>
        <option value="aiQuotaAvailable">Todavía hay cuota de IA</option>
        <option value="hasTag">El cliente tiene una etiqueta</option>
        <option value="field">Un dato del cliente cumple algo</option>
      </select>
      {c.kind === "hasTag" && <input aria-label="Etiqueta" className={inputCls} placeholder="Etiqueta" value={c.tag} onChange={(e) => onChange({ ...c, tag: e.target.value })} />}
      {c.kind === "field" && (
        <div className="grid grid-cols-3 gap-2">
          <input aria-label="Dato" className={inputCls} placeholder="Dato" value={c.key} onChange={(e) => onChange({ ...c, key: e.target.value })} />
          <select aria-label="Operador" className={inputCls} value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as "eq" | "neq" | "contains" })}>
            <option value="eq">es</option><option value="neq">no es</option><option value="contains">contiene</option>
          </select>
          <input aria-label="Valor" className={inputCls} placeholder="Valor" value={c.value} onChange={(e) => onChange({ ...c, value: e.target.value })} />
        </div>
      )}
      {onRemove && <Btn variant="ghost" onClick={onRemove}>Quitar condición</Btn>}
    </div>
  );
}

function ActionRow({ a, onChange, onRemove }: { a: Act; onChange: (a: Act) => void; onRemove?: () => void }) {
  return (
    <div className="space-y-2 rounded-md border border-line p-2.5">
      <select aria-label="Tipo de acción" className={inputCls} value={a.kind}
        onChange={(e) => {
          const k = e.target.value as Act["kind"];
          onChange(k === "addTag" ? { kind: k, tag: "" } : k === "setField" ? { kind: k, key: "", value: "" } : k === "note" ? { kind: k, text: "" } : { kind: k, url: "https://", method: "POST" });
        }}>
        <option value="addTag">Añadir una etiqueta</option>
        <option value="setField">Guardar un dato del cliente</option>
        <option value="note">Dejar una nota para el equipo</option>
        <option value="http">Llamar a una URL (webhook)</option>
      </select>
      {a.kind === "addTag" && <input aria-label="Etiqueta" className={inputCls} placeholder="Etiqueta" value={a.tag} onChange={(e) => onChange({ ...a, tag: e.target.value })} />}
      {a.kind === "setField" && (
        <div className="grid grid-cols-2 gap-2">
          <input aria-label="Dato" className={inputCls} placeholder="Dato" value={a.key} onChange={(e) => onChange({ ...a, key: e.target.value })} />
          <input aria-label="Valor" className={inputCls} placeholder="Valor" value={a.value} onChange={(e) => onChange({ ...a, value: e.target.value })} />
        </div>
      )}
      {a.kind === "note" && <input aria-label="Nota" className={inputCls} placeholder="Nota" value={a.text} onChange={(e) => onChange({ ...a, text: e.target.value })} />}
      {a.kind === "http" && (
        <div className="space-y-2">
          <input aria-label="URL" className={inputCls} placeholder="https://…" value={a.url} onChange={(e) => onChange({ ...a, url: e.target.value })} />
          <select aria-label="Método" className={inputCls} value={a.method} onChange={(e) => onChange({ ...a, method: e.target.value as "GET" | "POST" })}>
            <option value="POST">POST</option><option value="GET">GET</option>
          </select>
        </div>
      )}
      {onRemove && <Btn variant="ghost" onClick={onRemove}>Quitar acción</Btn>}
    </div>
  );
}
