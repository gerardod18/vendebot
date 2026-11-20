import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Btn, Card, ErrorText, Field, PageTitle, inputCls, useRun } from "../components/ui";
import { useOrg } from "../lib/org";

type Key = "defaultReply" | "keywordReply" | "welcome" | "commentToDm" | "storyMention";
const TEMPLATES: Record<Key, { title: string; desc: string }> = {
  defaultReply: { title: "Respuesta por defecto", desc: "Responde cuando ningún otro automatismo aplica. En horario laboral puede contestar la IA; fuera de horario, un mensaje fijo." },
  keywordReply: { title: "Respuesta por palabra clave", desc: "Responde cuando el mensaje contiene ciertas palabras (p. ej. «precio»)." },
  welcome: { title: "Mensaje de bienvenida", desc: "Se envía la primera vez que alguien te escribe." },
  commentToDm: { title: "Comentario → mensaje privado", desc: "Cuando comentan en una publicación, les escribes por DM (y opcionalmente respondes en público)." },
  storyMention: { title: "Mención en historia", desc: "Agradece cuando te mencionan en una historia." },
};
const TYPE_LABEL: Record<string, string> = { default: "Por defecto", keyword: "Palabra clave", welcome: "Bienvenida", comment: "Comentario", storyMention: "Historia" };

export function Automations() {
  const { org, isAdmin } = useOrg();
  const list = useQuery(api.automations.list, { orgId: org.orgId });
  const setEnabled = useMutation(api.automations.setEnabled);
  const remove = useMutation(api.automations.remove);
  const [creating, setCreating] = useState(false);
  const { run, error } = useRun();

  return (
    <>
      <PageTitle title="Automatizaciones">{isAdmin && !creating && <Btn onClick={() => setCreating(true)}>Nueva</Btn>}</PageTitle>
      {creating && <NewAutomation onDone={() => setCreating(false)} />}
      <ErrorText error={error} />
      <div className="space-y-2">
        {(list ?? []).map((a) => (
          <Card key={a.triggerId} className="flex items-center gap-3">
            <div className="flex-1">
              <p className="font-medium">{a.name}</p>
              <p className="text-xs text-zinc-500">
                {TYPE_LABEL[a.type] ?? a.type}
                {a.config?.keywords?.length ? ` · ${a.config.keywords.join(", ")}` : ""} · enviada {a.firedCount} {a.firedCount === 1 ? "vez" : "veces"}
              </p>
            </div>
            {isAdmin && (
              <>
                <label className="flex items-center gap-1 text-sm">
                  <input type="checkbox" checked={a.enabled} onChange={(e) => run(() => setEnabled({ orgId: org.orgId, triggerId: a.triggerId, enabled: e.target.checked }))} /> Activa
                </label>
                <Btn variant="ghost" onClick={() => confirm("¿Eliminar esta automatización?") && run(() => remove({ orgId: org.orgId, triggerId: a.triggerId }))}>Eliminar</Btn>
              </>
            )}
          </Card>
        ))}
        {list?.length === 0 && !creating && <p className="text-sm text-zinc-500">Todavía no tienes automatizaciones. Crea la primera con «Nueva».</p>}
      </div>
    </>
  );
}

function NewAutomation({ onDone }: { onDone: () => void }) {
  const { org } = useOrg();
  const accounts = useQuery(api.accounts.list, { orgId: org.orgId });
  const create = useMutation(api.automations.create);
  const { runOk, busy, error } = useRun();

  const [key, setKey] = useState<Key>("keywordReply");
  const [account, setAccount] = useState<string>("");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [keywords, setKeywords] = useState("");
  const [match, setMatch] = useState<"contains" | "exact">("contains");
  const [handoff, setHandoff] = useState(false);
  const [publicReply, setPublicReply] = useState("");
  const [mediaIds, setMediaIds] = useState("");
  const [fallback, setFallback] = useState("Gracias por escribirnos. Te respondemos en unos minutos.");
  const [useAi, setUseAi] = useState(false);
  const [aiInstr, setAiInstr] = useState("");
  const [exitWhen, setExitWhen] = useState("");

  const active = (accounts ?? []).filter((a) => a.status === "active");
  const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const igAccountId = (account || active[0]?.accountId) as Id<"igAccounts"> | undefined;
    if (!igAccountId) return;
    const template =
      key === "defaultReply"
        ? { key, fallbackText: fallback, ...(useAi ? { ai: { instructions: aiInstr, ...(exitWhen ? { exitWhen } : {}) } } : {}) }
        : { key, text, ...(handoff ? { handoffAfter: true } : {}) };
    const ok = await runOk(() => create({
      orgId: org.orgId, igAccountId, name: name || TEMPLATES[key].title, template,
      keywords: key === "keywordReply" || key === "commentToDm" ? split(keywords) : undefined,
      match: key === "keywordReply" || key === "commentToDm" ? match : undefined,
      mediaIds: key === "commentToDm" && mediaIds ? split(mediaIds) : undefined,
      publicReply: key === "commentToDm" && publicReply ? publicReply : undefined,
    }));
    if (ok) onDone();
  }

  if (accounts && active.length === 0) {
    return <Card className="mb-4"><p className="text-sm">Primero conecta una cuenta de Instagram (menú «Instagram»).</p><Btn variant="ghost" className="mt-2" onClick={onDone}>Cerrar</Btn></Card>;
  }

  return (
    <Card className="mb-4">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Tipo" hint={TEMPLATES[key].desc}>
          <select className={inputCls} value={key} onChange={(e) => setKey(e.target.value as Key)}>
            {(Object.keys(TEMPLATES) as Key[]).map((k) => <option key={k} value={k}>{TEMPLATES[k].title}</option>)}
          </select>
        </Field>
        {active.length > 1 && (
          <Field label="Cuenta"><select className={inputCls} value={account} onChange={(e) => setAccount(e.target.value)}>
            {active.map((a) => <option key={a.accountId} value={a.accountId}>@{a.username}</option>)}</select></Field>
        )}
        <Field label="Nombre (opcional)"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>

        {(key === "keywordReply" || key === "commentToDm") && (
          <>
            <Field label={key === "commentToDm" ? "Palabras clave (opcional)" : "Palabras clave"} hint="Separadas por comas. No distingue mayúsculas ni acentos.">
              <input className={inputCls} value={keywords} onChange={(e) => setKeywords(e.target.value)} required={key === "keywordReply"} />
            </Field>
            <Field label="Coincidencia"><select className={inputCls} value={match} onChange={(e) => setMatch(e.target.value as "contains" | "exact")}>
              <option value="contains">Contiene la palabra</option><option value="exact">Mensaje exacto</option></select></Field>
          </>
        )}
        {key === "commentToDm" && (
          <>
            <Field label="Respuesta pública (opcional)" hint="Se publica bajo el comentario, p. ej. «¡Te escribí por DM!»."><input className={inputCls} value={publicReply} onChange={(e) => setPublicReply(e.target.value)} maxLength={300} /></Field>
            <Field label="Solo estas publicaciones (opcional)" hint="IDs de publicación separados por comas. Vacío = todas."><input className={inputCls} value={mediaIds} onChange={(e) => setMediaIds(e.target.value)} /></Field>
          </>
        )}
        {key !== "defaultReply" ? (
          <>
            <Field label="Mensaje" hint="Puedes usar {{first_name}} para el nombre."><textarea className={inputCls} rows={3} value={text} onChange={(e) => setText(e.target.value)} required maxLength={1000} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={handoff} onChange={(e) => setHandoff(e.target.checked)} /> Pasar la conversación a una persona después</label>
          </>
        ) : (
          <>
            <Field label="Mensaje cuando la IA no está disponible" hint="Fuera de horario o si se acabó la cuota de IA."><textarea className={inputCls} rows={2} value={fallback} onChange={(e) => setFallback(e.target.value)} required /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} /> Que responda la IA en horario laboral</label>
            {useAi && (
              <>
                <Field label="Instrucciones para la IA" hint="Qué debe lograr en la conversación. Lo que sabe de tu negocio sale de «Conocimiento»."><textarea className={inputCls} rows={4} value={aiInstr} onChange={(e) => setAiInstr(e.target.value)} required maxLength={4000} /></Field>
                <Field label="Cuándo terminar (opcional)" hint="Ej.: cuando el cliente deje su teléfono."><input className={inputCls} value={exitWhen} onChange={(e) => setExitWhen(e.target.value)} maxLength={500} /></Field>
              </>
            )}
          </>
        )}
        <ErrorText error={error} />
        <div className="flex gap-2"><Btn disabled={busy}>Crear</Btn><Btn type="button" variant="ghost" onClick={onDone}>Cancelar</Btn></div>
      </form>
    </Card>
  );
}
