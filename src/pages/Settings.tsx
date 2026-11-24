import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Btn, Card, ErrorText, Field, PageTitle, fmtTime, inputCls, useRun } from "../components/ui";
import { useOrg } from "../lib/org";

const MODELS = {
  anthropic: ["claude-haiku-5-5", "claude-sonnet-5-5"],
  openrouter: ["anthropic/claude-haiku-5-5", "anthropic/claude-sonnet-5-5", "openai/gpt-5-mini", "google/gemini-2.5-flash", "meta-llama/llama-3.3-70b-instruct"],
} as const;
const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export function Settings() {
  const { org, isAdmin } = useOrg();
  if (!isAdmin) return <p className="text-sm text-ink-soft">Solo los administradores pueden cambiar los ajustes.</p>;
  return (
    <>
      <PageTitle title="Ajustes" />
      <div className="space-y-4">
        <AiSettings /><BusinessSettings /><Team />
        <p className="text-xs text-ink-soft">Espacio de trabajo: {org.name}</p>
      </div>
    </>
  );
}

function AiSettings() {
  const { org } = useOrg();
  const s = useQuery(api.orgs.getSettings, { orgId: org.orgId });
  const save = useMutation(api.orgs.setAiConfig);
  const [provider, setProvider] = useState<"anthropic" | "openrouter">("anthropic");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const { runOk, run, busy, error } = useRun();
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (s) { setProvider(s.aiProvider); setModel(s.aiModel); } }, [s?.aiProvider, s?.aiModel]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await runOk(() => save({ orgId: org.orgId, provider, model, ...(key ? { apiKey: key } : {}) }))) { setKey(""); setSaved(true); }
  }
  return (
    <Card>
      <h2 className="mb-2 font-medium">Inteligencia artificial</h2>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Proveedor"><select className={inputCls} value={provider} onChange={(e) => { const p = e.target.value as "anthropic" | "openrouter"; setProvider(p); setModel(MODELS[p][0]); }}>
          <option value="anthropic">Anthropic (Claude)</option><option value="openrouter">OpenRouter (muchos modelos)</option></select></Field>
        <Field label="Modelo" hint={provider === "openrouter" ? "Formato proveedor/modelo, ver openrouter.ai/models" : "Haiku es el más económico; Sonnet es más inteligente."}>
          <input className={inputCls} list="models" value={model} onChange={(e) => setModel(e.target.value)} required />
          <datalist id="models">{MODELS[provider].map((m) => <option key={m} value={m} />)}</datalist></Field>
        <Field label={`Tu propia clave de API (opcional)${s?.hasByoKey ? " · ya hay una guardada" : ""}`} hint="Con tu clave no hay límite mensual de respuestas de IA. Se guarda cifrada. Déjalo vacío para no cambiarla; usa «Quitar clave» para borrarla.">
          <input className={inputCls} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={provider === "openrouter" ? "sk-or-…" : "sk-ant-…"} /></Field>
        <ErrorText error={error} />
        <div className="flex items-center gap-2">
          <Btn disabled={busy}>Guardar</Btn>
          {s?.hasByoKey && <Btn type="button" variant="ghost" onClick={() => run(() => save({ orgId: org.orgId, provider, model, apiKey: "" }))}>Quitar clave</Btn>}
          {saved && !error && <span className="text-sm text-ok">Guardado</span>}
        </div>
      </form>
    </Card>
  );
}

function BusinessSettings() {
  const { org } = useOrg();
  const s = useQuery(api.orgs.getSettings, { orgId: org.orgId });
  const save = useMutation(api.orgs.updateSettings);
  const [tz, setTz] = useState("UTC");
  const [days, setDays] = useState<number[]>([]);
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("17:00");
  const [lang, setLang] = useState("es");
  const [instr, setInstr] = useState("");
  const { runOk, busy, error } = useRun();
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!s) return;
    setTz(s.timezone); setDays(s.businessHours.days); setStart(s.businessHours.start); setEnd(s.businessHours.end);
    setLang(s.defaultLanguage); setInstr(s.aiInstructions ?? "");
  }, [s?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await runOk(() => save({ orgId: org.orgId, timezone: tz, businessHours: { days, start, end }, defaultLanguage: lang, aiInstructions: instr }))) setSaved(true);
  }
  return (
    <Card>
      <h2 className="mb-2 font-medium">Negocio</h2>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Zona horaria" hint="Ej.: America/Bogota, America/Mexico_City, Europe/Madrid"><input className={inputCls} value={tz} onChange={(e) => setTz(e.target.value)} /></Field>
        <Field label="Horario de atención (la IA responde solo en este horario si la automatización lo pide)">
          <div className="flex flex-wrap items-center gap-2">
            {DAYS.map((d, i) => <label key={d} className="text-sm"><input type="checkbox" checked={days.includes(i)} onChange={(e) => setDays(e.target.checked ? [...days, i].sort() : days.filter((x) => x !== i))} /> {d}</label>)}
            <input type="time" className="rounded border px-2 py-1 text-sm" value={start} onChange={(e) => setStart(e.target.value)} /> a
            <input type="time" className="rounded border px-2 py-1 text-sm" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </Field>
        <Field label="Idioma por defecto"><select className={inputCls} value={lang} onChange={(e) => setLang(e.target.value)}><option value="es">Español</option><option value="en">English</option><option value="pt">Português</option></select></Field>
        <Field label="Cómo debe hablar tu asistente" hint="Qué vendes, tono, qué NO debe prometer. Los precios y stock solo se dicen si están en «Conocimiento».">
          <textarea className={inputCls} rows={5} value={instr} onChange={(e) => setInstr(e.target.value)} maxLength={4000} /></Field>
        <ErrorText error={error} />
        <div className="flex items-center gap-2"><Btn disabled={busy}>Guardar</Btn>{saved && !error && <span className="text-sm text-ok">Guardado</span>}</div>
      </form>
    </Card>
  );
}

function Team() {
  const { org } = useOrg();
  const members = useQuery(api.orgs.listMembers, { orgId: org.orgId });
  const invites = useQuery(api.orgs.listInvites, { orgId: org.orgId });
  const invite = useMutation(api.orgs.invite);
  const revoke = useMutation(api.orgs.revokeInvite);
  const removeMember = useMutation(api.orgs.removeMember);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"agent" | "admin">("agent");
  const { run, busy, error } = useRun();
  const link = (t: string) => `${window.location.origin}/invite/${t}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (await run(() => invite({ orgId: org.orgId, email, role }))) setEmail("");
  }
  return (
    <Card>
      <h2 className="mb-2 font-medium">Equipo</h2>
      <ul className="mb-3 divide-y text-sm">{(members ?? []).map((m) => (
        <li key={m._id} className="flex items-center gap-2 py-1.5"><span className="flex-1 font-mono text-xs">{m.userId}</span><span>{m.role}</span>
          {m.role !== "owner" && <Btn variant="ghost" onClick={() => confirm("¿Quitar del equipo?") && run(() => removeMember({ orgId: org.orgId, memberUserId: m.userId }))}>Quitar</Btn>}</li>))}</ul>
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <input className={`${inputCls} max-w-xs`} type="email" placeholder="email@ejemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <select className="rounded border px-2 text-sm" value={role} onChange={(e) => setRole(e.target.value as "agent" | "admin")}><option value="agent">Agente</option><option value="admin">Admin</option></select>
        <Btn disabled={busy}>Invitar</Btn>
      </form>
      <ErrorText error={error} />
      {(invites ?? []).length > 0 && <ul className="mt-3 space-y-1 text-xs">{invites!.map((i) => (
        <li key={i.id} className="flex items-center gap-2"><span>{i.email} ({i.role}) · vence {fmtTime(i.expiresAt)}</span>
          <button className="underline" onClick={() => navigator.clipboard?.writeText(link(i.token))}>Copiar enlace</button>
          <button className="underline" onClick={() => run(() => revoke({ orgId: org.orgId, inviteId: i.id }))}>Revocar</button></li>))}</ul>}
      <p className="mt-2 text-xs text-ink-soft">Comparte el enlace de invitación con la persona (aún no enviamos correos).</p>
    </Card>
  );
}
