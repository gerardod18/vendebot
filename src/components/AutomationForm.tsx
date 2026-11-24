import { useMemo, useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useOrg } from "../lib/org";
import { TextWithVars } from "./TextWithVars";
import { Btn, ChannelBadge, ErrorText, Field, inputCls, useRun, type Channel } from "./ui";

export type Key = "defaultReply" | "keywordReply" | "welcome" | "commentToDm" | "storyMention";

export const TEMPLATES: Record<Key, { title: string; desc: string; group: string }> = {
  welcome: { title: "Mensaje de bienvenida", desc: "Se envía la primera vez que alguien te escribe.", group: "Bienvenida" },
  keywordReply: { title: "Respuesta por palabra clave", desc: "Responde cuando el mensaje contiene ciertas palabras, por ejemplo «precio».", group: "Palabras clave" },
  defaultReply: { title: "Respuesta por defecto", desc: "Responde cuando ninguna otra automatización aplica. En horario de atención puede contestar la IA.", group: "Respuesta por defecto" },
  commentToDm: { title: "Comentario a mensaje privado", desc: "Cuando comentan una publicación, les escribes por mensaje privado.", group: "Comentarios" },
  storyMention: { title: "Mención en historia", desc: "Agradece cuando te mencionan en una historia.", group: "Menciones en historia" },
};
export const GROUP_ORDER: Key[] = ["welcome", "keywordReply", "defaultReply", "commentToDm", "storyMention"];
export const TYPE_TO_KEY: Record<string, Key> = { welcome: "welcome", keyword: "keywordReply", default: "defaultReply", comment: "commentToDm", storyMention: "storyMention" };

type Account = { accountId: Id<"igAccounts">; username: string; channel: Channel; status: string };
type Existing = {
  triggerId: Id<"triggers">; name: string; templateKey: string | null; templateConfig: any; type: string; config: any; igAccountId: Id<"igAccounts">;
};

const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/**
 * Create or edit an automation built from a template. Single column, persistent labels, helper text under the label,
 * errors under the field after the person leaves it (or after a submit attempt).
 */
export function AutomationForm({ accounts, existing, onDone }: { accounts: Account[]; existing?: Existing; onDone: (triggerId?: Id<"triggers">) => void }) {
  const { org } = useOrg();
  const create = useMutation(api.automations.create);
  const update = useMutation(api.automations.update);
  const updateTrigger = useMutation(api.automations.updateTrigger);
  const { runOk, run, busy, error } = useRun();

  const editing = Boolean(existing);
  const asForm = !existing || Boolean(existing.templateConfig); // false: edited in the flow editor, only trigger settings here
  const tc = existing?.templateConfig as any;
  const active = accounts.filter((a) => a.status === "active");

  const [key, setKey] = useState<Key>(existing ? TYPE_TO_KEY[existing.type] : "welcome");
  const [account, setAccount] = useState<string>(existing?.igAccountId ?? active[0]?.accountId ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [keywords, setKeywords] = useState((existing?.config?.keywords ?? []).join(", "));
  const [match, setMatch] = useState<"contains" | "exact">(existing?.config?.match ?? "contains");
  const [text, setText] = useState(tc?.text ?? "");
  const [handoff, setHandoff] = useState(Boolean(tc?.handoffAfter));
  const [publicReply, setPublicReply] = useState(existing?.config?.publicReply ?? "");
  const [mediaIds, setMediaIds] = useState((existing?.config?.mediaIds ?? []).join(", "));
  const [fallback, setFallback] = useState(tc?.fallbackText ?? "Gracias por escribirnos. Te respondemos en unos minutos.");
  const [useAi, setUseAi] = useState(Boolean(tc?.ai));
  const [aiInstr, setAiInstr] = useState(tc?.ai?.instructions ?? "");
  const [exitWhen, setExitWhen] = useState(tc?.ai?.exitWhen ?? "");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const touch = (f: string) => () => setTouched((t) => ({ ...t, [f]: true }));

  const needsKeywords = key === "keywordReply";
  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (name.length > 80) e.name = "El nombre puede tener hasta 80 letras.";
    if (needsKeywords && split(keywords).length === 0) e.keywords = "Escribe al menos una palabra clave, por ejemplo: precio, costo.";
    if (asForm && key !== "defaultReply" && !text.trim()) e.text = "Escribe el mensaje que recibirá el cliente.";
    if (asForm && key === "defaultReply" && !fallback.trim()) e.fallback = "Escribe el mensaje para cuando la IA no esté disponible.";
    if (asForm && key === "defaultReply" && useAi && !aiInstr.trim()) e.aiInstr = "Cuéntale a la IA qué debe lograr en la conversación.";
    return e;
  }, [name, keywords, text, fallback, aiInstr, key, useAi, needsKeywords, asForm]);
  const show = (f: string) => (touched[f] || submitted ? errors[f] ?? null : null);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length || (!editing && !account)) return;
    const trig = {
      keywords: key === "keywordReply" || key === "commentToDm" ? split(keywords) : undefined,
      match: key === "keywordReply" || key === "commentToDm" ? match : undefined,
      mediaIds: key === "commentToDm" && mediaIds ? split(mediaIds) : undefined,
      publicReply: key === "commentToDm" && publicReply ? publicReply : undefined,
    };
    const finalName = name.trim() || TEMPLATES[key].title;
    const template =
      key === "defaultReply"
        ? { key, fallbackText: fallback, ...(useAi ? { ai: { instructions: aiInstr, ...(exitWhen ? { exitWhen } : {}) } } : {}) }
        : { key, text, ...(handoff ? { handoffAfter: true } : {}) };
    if (existing) {
      const ok = asForm
        ? await runOk(() => update({ orgId: org.orgId, triggerId: existing.triggerId, name: finalName, template, ...trig }))
        : await runOk(() => updateTrigger({ orgId: org.orgId, triggerId: existing.triggerId, name: finalName, ...trig }));
      if (ok) onDone(existing.triggerId);
    } else {
      const r = await run(() => create({ orgId: org.orgId, igAccountId: account as Id<"igAccounts">, name: finalName, template, ...trig }));
      if (r) onDone(r.triggerId);
    }
  }

  if (!editing && active.length === 0) {
    return <p className="text-sm text-ink-soft">Primero conecta una cuenta de Instagram o WhatsApp en la sección Cuentas.</p>;
  }

  return (
    <form onSubmit={submit} noValidate className="max-w-xl space-y-5">
      {!editing ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">¿Cuándo debe responder?</legend>
          {GROUP_ORDER.map((k) => (
            <label key={k} className={`flex cursor-pointer gap-3 rounded-md border p-3 ${key === k ? "border-brand bg-brand-wash" : "border-line"}`}>
              <input type="radio" name="type" className="mt-1" checked={key === k} onChange={() => setKey(k)} />
              <span><span className="block text-sm font-medium">{TEMPLATES[k].title}</span><span className="block text-xs text-ink-soft">{TEMPLATES[k].desc}</span></span>
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="text-sm text-ink-soft">Tipo: <span className="font-medium text-ink">{TEMPLATES[key].title}</span>. {TEMPLATES[key].desc}</p>
      )}

      {!editing && active.length > 1 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Cuenta</legend>
          {active.map((a) => (
            <label key={a.accountId} className="flex cursor-pointer items-center gap-3 rounded-md border border-line p-2.5">
              <input type="radio" name="account" checked={account === a.accountId} onChange={() => setAccount(a.accountId)} />
              <ChannelBadge channel={a.channel} /><span className="text-sm">{a.channel === "whatsapp" ? a.username : `@${a.username}`}</span>
            </label>
          ))}
        </fieldset>
      )}

      <Field label="Nombre interno" optional hint="Solo lo ves tú, el cliente no lo recibe." error={show("name")}>
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} onBlur={touch("name")} maxLength={80} placeholder={TEMPLATES[key].title} />
      </Field>

      {(key === "keywordReply" || key === "commentToDm") && (
        <>
          <Field label="Palabras clave" optional={key === "commentToDm"} hint="Separadas por comas. No distingue mayúsculas ni acentos." error={show("keywords")}>
            <input className={inputCls} value={keywords} onChange={(e) => setKeywords(e.target.value)} onBlur={touch("keywords")} placeholder="precio, costo, cuánto cuesta" />
          </Field>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Cuándo coincide</legend>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="match" checked={match === "contains"} onChange={() => setMatch("contains")} /> El mensaje contiene la palabra</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="match" checked={match === "exact"} onChange={() => setMatch("exact")} /> El mensaje es exactamente la palabra</label>
          </fieldset>
        </>
      )}

      {key === "commentToDm" && (
        <>
          <Field label="Respuesta pública" optional hint="Se publica bajo el comentario, por ejemplo «¡Te escribí por mensaje privado!».">
            <input className={inputCls} value={publicReply} onChange={(e) => setPublicReply(e.target.value)} maxLength={300} />
          </Field>
          <Field label="Solo estas publicaciones" optional hint="Identificadores de publicación separados por comas. Vacío significa todas.">
            <input className={inputCls} value={mediaIds} onChange={(e) => setMediaIds(e.target.value)} />
          </Field>
        </>
      )}

      {asForm && key !== "defaultReply" && (
        <>
          <TextWithVars label="Mensaje" hint="Lo que recibe el cliente. Puedes insertar su nombre con los botones de abajo." value={text} onChange={setText} onBlur={touch("text")} maxLength={1000} error={show("text")} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={handoff} onChange={(e) => setHandoff(e.target.checked)} /> Pasar la conversación a una persona después</label>
        </>
      )}

      {asForm && key === "defaultReply" && (
        <>
          <Field label="Mensaje cuando la IA no está disponible" hint="Se envía fuera del horario de atención o si se acabó la cuota de IA." error={show("fallback")}>
            <textarea className={inputCls} rows={3} value={fallback} onChange={(e) => setFallback(e.target.value)} onBlur={touch("fallback")} />
          </Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} /> Que responda la IA en horario de atención</label>
          {useAi && (
            <>
              <TextWithVars label="Instrucciones para la IA" hint="Qué debe lograr en la conversación. Lo que sabe de tu negocio sale de Conocimiento." value={aiInstr} onChange={setAiInstr} onBlur={touch("aiInstr")} rows={4} maxLength={4000} error={show("aiInstr")} />
              <Field label="Cuándo termina" optional hint="Por ejemplo: cuando el cliente deje su teléfono."><input className={inputCls} value={exitWhen} onChange={(e) => setExitWhen(e.target.value)} maxLength={500} /></Field>
            </>
          )}
        </>
      )}

      {!asForm && <p className="rounded-md bg-ground p-3 text-sm text-ink-soft">El contenido de esta automatización se edita en la pestaña Flujo. Aquí solo cambias su nombre y cuándo se activa.</p>}

      <ErrorText error={error} />
      <div className="flex gap-2">
        <Btn type="submit" disabled={busy}>{editing ? "Guardar cambios" : "Crear automatización"}</Btn>
        <Btn variant="ghost" onClick={() => onDone()}>Cancelar</Btn>
      </div>
    </form>
  );
}
