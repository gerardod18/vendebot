import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Btn, Card, ErrorText, fmtTime, inputCls, useRun } from "../components/ui";
import { useOrg } from "../lib/org";

export function Inbox() {
  const { org } = useOrg();
  const list = useQuery(api.inbox.listConversations, { orgId: org.orgId });
  const [sel, setSel] = useState<Id<"conversations"> | null>(null);
  return (
    <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
      <div className="space-y-1">
        {(list ?? []).map((c) => (
          <button key={c.conversationId} onClick={() => setSel(c.conversationId)}
            className={`w-full rounded-lg border p-2 text-left ${sel === c.conversationId ? "border-zinc-900 bg-white" : "bg-white/60"}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{c.contactName}</span>
              {c.unread > 0 && <span className="rounded-full bg-emerald-600 px-1.5 text-xs text-white">{c.unread}</span>}
            </div>
            <p className="truncate text-xs text-zinc-500">{c.mode === "human" ? "👤 " : "🤖 "}{c.preview}</p>
          </button>
        ))}
        {list?.length === 0 && <p className="text-sm text-zinc-500">Aún no hay conversaciones.</p>}
      </div>
      {sel ? <Thread key={sel} conversationId={sel} /> : <Card><p className="text-sm text-zinc-500">Elige una conversación.</p></Card>}
    </div>
  );
}

function Thread({ conversationId }: { conversationId: Id<"conversations"> }) {
  const { org } = useOrg();
  const data = useQuery(api.inbox.getThread, { orgId: org.orgId, conversationId });
  const markRead = useMutation(api.inbox.markRead);
  const takeOver = useMutation(api.inbox.takeOver);
  const giveBack = useMutation(api.inbox.giveBack);
  const send = useMutation(api.inbox.sendHuman);
  const [text, setText] = useState("");
  const { run, runOk, busy, error } = useRun();
  const end = useRef<HTMLDivElement>(null);
  const count = data?.messages.length ?? 0;

  useEffect(() => { void markRead({ orgId: org.orgId, conversationId }).catch(() => {}); }, [count, conversationId, markRead, org.orgId]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [count]);

  if (!data) return <Card>Cargando…</Card>;
  const human = data.conversation.mode === "human";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await runOk(() => send({ orgId: org.orgId, conversationId, text }))) setText("");
  }

  return (
    <Card className="flex h-[70vh] flex-col">
      <div className="mb-2 flex items-center gap-2 border-b pb-2">
        <div className="flex-1">
          <p className="font-medium">{data.contact?.name ?? data.contact?.username ?? "Contacto"}</p>
          <p className="text-xs text-zinc-500">{human ? "Atiende una persona" : "Atiende el bot"}{data.contact?.tags.length ? ` · ${data.contact.tags.join(", ")}` : ""}</p>
        </div>
        {human ? <Btn variant="ghost" onClick={() => run(() => giveBack({ orgId: org.orgId, conversationId }))}>Devolver al bot</Btn>
          : <Btn onClick={() => run(() => takeOver({ orgId: org.orgId, conversationId }))}>Tomar conversación</Btn>}
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto">
        {data.messages.map((m) => (
          <div key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : ""}`}>
            <div className={`max-w-[75%] rounded-lg px-3 py-1.5 text-sm ${m.direction === "out" ? (m.status === "failed" ? "bg-red-100" : m.source === "ai" ? "bg-violet-100" : "bg-zinc-900 text-white") : "bg-zinc-100"}`}>
              {m.text ?? `[${m.kind}]`}
              <div className="mt-0.5 text-[10px] opacity-60">{m.direction === "out" ? m.source : ""} {fmtTime(m.at)}{m.status === "failed" ? ` · falló: ${m.error ?? ""}` : ""}</div>
            </div>
          </div>
        ))}
        {data.notes.map((n) => <p key={n.id} className="text-center text-xs text-amber-700">📝 {n.text}</p>)}
        <div ref={end} />
      </div>
      <form onSubmit={submit} className="mt-2 flex gap-2">
        <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} disabled={!data.canReply}
          placeholder={data.canReply ? "Escribe una respuesta (el bot se pausa)" : "Pasaron más de 7 días: ya no puedes responder"} maxLength={1000} />
        <Btn disabled={busy || !data.canReply || !text.trim()}>Enviar</Btn>
      </form>
      <ErrorText error={error} />
    </Card>
  );
}
