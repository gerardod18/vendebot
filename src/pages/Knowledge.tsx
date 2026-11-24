import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Btn, Card, ErrorText, Field, PageTitle, inputCls, useRun } from "../components/ui";
import { useOrg } from "../lib/org";

export function Knowledge() {
  const { org, isAdmin } = useOrg();
  const list = useQuery(api.knowledge.list, { orgId: org.orgId });
  const save = useMutation(api.knowledge.save);
  const remove = useMutation(api.knowledge.remove);
  const [editing, setEditing] = useState<{ id?: Id<"knowledge">; title: string; content: string } | null>(null);
  const { run, runOk, busy, error } = useRun();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (await runOk(() => save({ orgId: org.orgId, ...editing }))) setEditing(null);
  }

  return (
    <>
      <PageTitle title="Conocimiento del negocio">{isAdmin && !editing && <Btn onClick={() => setEditing({ title: "", content: "" })}>Agregar</Btn>}</PageTitle>
      <p className="mb-3 text-sm text-ink-soft">Lo que escribas aquí es lo único que la IA usará para responder (horarios, envíos, precios, preguntas frecuentes). Si no está aquí, la IA pasará la conversación a una persona.</p>
      {editing && (
        <Card className="mb-4">
          <form onSubmit={submit} className="space-y-3">
            <Field label="Título"><input className={inputCls} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} required maxLength={100} /></Field>
            <Field label="Contenido"><textarea className={inputCls} rows={6} value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} required maxLength={4000} /></Field>
            <ErrorText error={error} />
            <div className="flex gap-2"><Btn disabled={busy}>Guardar</Btn><Btn type="button" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Btn></div>
          </form>
        </Card>
      )}
      <div className="space-y-2">
        {(list ?? []).map((k) => (
          <Card key={k.id}>
            <div className="flex items-start gap-2">
              <div className="flex-1"><p className="font-medium">{k.title}</p><p className="whitespace-pre-wrap text-sm text-ink-soft">{k.content}</p></div>
              {isAdmin && <><Btn variant="ghost" onClick={() => setEditing({ id: k.id, title: k.title, content: k.content })}>Editar</Btn>
                <Btn variant="ghost" onClick={() => confirm("¿Eliminar?") && run(() => remove({ orgId: org.orgId, id: k.id }))}>Eliminar</Btn></>}
            </div>
          </Card>
        ))}
        {list?.length === 0 && !editing && <p className="text-sm text-ink-soft">Aún no hay información.</p>}
      </div>
    </>
  );
}
