import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Btn, Card, ErrorText, Field, inputCls, useRun } from "../components/ui";

/** First-run screen (also used to add another workspace). */
export function CreateWorkspace({ onDone }: { onDone?: (orgId: string) => void }) {
  const create = useMutation(api.orgs.create);
  const [name, setName] = useState("");
  const { run, busy, error } = useRun();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const id = await run(() => create({ name }));
    if (id) onDone?.(id);
  }
  return (
    <div className="mx-auto mt-24 max-w-md">
      <Card>
        <h1 className="text-xl font-semibold">Bienvenido a vendebot</h1>
        <p className="mt-1 text-sm text-zinc-600">Empecemos: ¿cómo se llama tu negocio?</p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <Field label="Nombre del negocio"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={60} /></Field>
          <ErrorText error={error} />
          <Btn disabled={busy}>Crear espacio de trabajo</Btn>
        </form>
      </Card>
    </div>
  );
}
