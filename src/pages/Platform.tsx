import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Btn, Card, ErrorText, Field, Notice, PageTitle, fmtTime, inputCls, useRun } from "../components/ui";

const MODELS = {
  anthropic: ["claude-haiku-5-5", "claude-sonnet-5-5"],
  openrouter: ["anthropic/claude-haiku-5-5", "anthropic/claude-sonnet-5-5", "openai/gpt-5-mini", "google/gemini-2.5-flash", "meta-llama/llama-3.3-70b-instruct"],
} as const;

type OrgSnapshot = NonNullable<FunctionReturnType<typeof api.platform.openOrg>>;

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;

/** Platform section for superAdmins: AI provider for the whole service, every workspace, operators and an audit log. */
export function Platform() {
  const me = useQuery(api.platform.me);
  const claim = useMutation(api.platform.claim);
  const { run, busy, error } = useRun();

  if (me === undefined) return <p className="text-sm text-ink-soft">Cargando…</p>;
  if (!me.isSuperAdmin) {
    return (
      <>
        <PageTitle title="Plataforma" />
        {me.canClaim ? (
          <Card className="max-w-xl space-y-3">
            <p className="text-sm">Tu correo está autorizado como superadministrador de la plataforma. Al activarlo podrás ver todos los espacios de trabajo y elegir el proveedor de IA del servicio.</p>
            <ErrorText error={error} />
            <Btn disabled={busy} onClick={() => run(() => claim({}))}>Activar superadministrador</Btn>
          </Card>
        ) : <p className="text-sm text-ink-soft">No tienes acceso a esta sección.</p>}
      </>
    );
  }
  return <Console />;
}

function Console() {
  const open = useMutation(api.platform.openOrg);
  const [detail, setDetail] = useState<OrgSnapshot | null>(null);
  const [selected, setSelected] = useState<Id<"orgs"> | null>(null);
  const [gone, setGone] = useState(false);
  const { run, error } = useRun();

  /** Opening a workspace is a mutation: the audit row is written together with the data it returns. */
  async function openOrg(orgId: Id<"orgs">) {
    setSelected(orgId); setGone(false);
    const d = await run(() => open({ orgId }));
    if (d) setDetail(d); else { setDetail(null); setGone(d === null); }
  }
  return (
    <>
      <PageTitle title="Plataforma" />
      <div className="space-y-6">
        <AiConfig />
        <Orgs selected={selected} onSelect={openOrg} />
        <ErrorText error={error} />
        {gone && <p className="text-sm text-ink-soft">Ese espacio ya no existe.</p>}
        {detail && <OrgDetail d={detail} onRefresh={() => openOrg(detail.orgId)} onClose={() => { setDetail(null); setSelected(null); }} />}
        <Admins />
        <Audit />
      </div>
    </>
  );
}

function AiConfig() {
  const cfg = useQuery(api.platform.getAiConfig);
  const save = useMutation(api.platform.setAiConfig);
  const [provider, setProvider] = useState<"anthropic" | "openrouter">("anthropic");
  const [model, setModel] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [saved, setSaved] = useState(false);
  const { runOk, busy, error } = useRun();
  useEffect(() => { if (cfg) { setProvider(cfg.provider); setModel(cfg.model); } }, [cfg?.provider, cfg?.model]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaved(false);
    const ok = await runOk(() => save({ provider, model, ...(anthropicKey ? { anthropicKey } : {}), ...(openRouterKey ? { openRouterKey } : {}) }));
    if (ok) { setAnthropicKey(""); setOpenRouterKey(""); setSaved(true); }
  }
  async function removeKey(which: "anthropic" | "openrouter") {
    // Removing a key must not also publish whatever is typed in the form: send the provider and model that are SAVED.
    if (!cfg) return;
    await runOk(() => save({ provider: cfg.provider, model: cfg.model, ...(which === "anthropic" ? { anthropicKey: "" } : { openRouterKey: "" }) }));
  }
  const keyState = (db: boolean | undefined, env: boolean | undefined) => (db ? "guardada aquí" : env ? "usa la variable de entorno" : "sin clave");

  return (
    <Card>
      <h2 className="text-lg font-semibold">Inteligencia artificial del servicio</h2>
      <p className="mt-1 text-sm text-ink-soft">Solo tú decides qué proveedor y modelo usan todos los espacios de trabajo. Los clientes no ven esta configuración.</p>
      <form onSubmit={submit} className="mt-4 max-w-xl space-y-4">
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Proveedor</legend>
          {(["anthropic", "openrouter"] as const).map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <input type="radio" name="provider" checked={provider === p} onChange={() => { setProvider(p); setModel(MODELS[p][0]); }} />
              {p === "anthropic" ? "Anthropic (Claude, API directa)" : "OpenRouter (muchos modelos con una sola clave)"}
            </label>
          ))}
        </fieldset>
        <Field label="Modelo" hint={provider === "openrouter" ? "Formato proveedor/modelo, por ejemplo openai/gpt-5-mini. Elige uno que admita herramientas." : "Haiku es el más económico; Sonnet es más capaz."}>
          <input className={inputCls} list="platform-models" value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>
        <datalist id="platform-models">{MODELS[provider].map((m) => <option key={m} value={m} />)}</datalist>
        <Field label="Clave de Anthropic" optional hint={`Estado: ${keyState(cfg?.hasAnthropicKey, cfg?.envAnthropicKey)}. Se guarda cifrada. Déjalo vacío para no cambiarla.`}>
          <input className={inputCls} type="password" autoComplete="off" value={anthropicKey} onChange={(e) => setAnthropicKey(e.target.value)} placeholder="sk-ant-…" />
        </Field>
        <Field label="Clave de OpenRouter" optional hint={`Estado: ${keyState(cfg?.hasOpenRouterKey, cfg?.envOpenRouterKey)}. Se guarda cifrada. Déjalo vacío para no cambiarla.`}>
          <input className={inputCls} type="password" autoComplete="off" value={openRouterKey} onChange={(e) => setOpenRouterKey(e.target.value)} placeholder="sk-or-…" />
        </Field>
        <ErrorText error={error} />
        {saved && <Notice>Guardado. Las próximas respuestas de IA usarán esta configuración.</Notice>}
        <div className="flex flex-wrap gap-2">
          <Btn type="submit" disabled={busy}>Guardar configuración</Btn>
          {cfg?.hasAnthropicKey && <Btn variant="ghost" onClick={() => removeKey("anthropic")}>Quitar clave de Anthropic</Btn>}
          {cfg?.hasOpenRouterKey && <Btn variant="ghost" onClick={() => removeKey("openrouter")}>Quitar clave de OpenRouter</Btn>}
        </div>
      </form>
    </Card>
  );
}

/** "100+" when the server stopped counting at its cap. */
const count = (n: number, capped: boolean) => (capped ? `${n}+` : String(n));

function Orgs({ selected, onSelect }: { selected: Id<"orgs"> | null; onSelect: (id: Id<"orgs">) => void }) {
  const data = useQuery(api.platform.overview);
  const rows = data?.orgs;
  return (
    <Card className="overflow-x-auto">
      <h2 className="text-lg font-semibold">Espacios de trabajo</h2>
      {data?.capped && <p className="mt-1 text-sm text-ink-soft">Mostrando los {data.limit} espacios más recientes. Hay más; los conteos marcados con «+» están limitados.</p>}
      <table className="mt-3 w-full min-w-[720px] text-left text-sm">
        <thead className="text-ink-soft">
          <tr>{["Nombre", "Plan", "Miembros", "Cuentas", "Automatizaciones", "Conversaciones", "IA este mes", "Última actividad"].map((h) => <th key={h} scope="col" className="py-2 pr-3 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {(rows ?? []).map((o) => (
            <tr key={o.orgId} className={`border-t border-line ${selected === o.orgId ? "bg-brand-wash" : ""}`}>
              <td className="py-2 pr-3"><button type="button" className="font-medium text-brand underline-offset-2 hover:underline" onClick={() => onSelect(o.orgId)}>{o.name}</button></td>
              <td className="pr-3">{o.plan}</td>
              <td className="pr-3">{count(o.members, o.capped.members)}</td>
              <td className="pr-3">{count(o.accounts, o.capped.accounts)}</td>
              <td className="pr-3">{count(o.automations, o.capped.automations)}</td>
              <td className="pr-3">{count(o.conversations, o.capped.conversations)}</td>
              <td className="pr-3">{o.aiReplies}/{o.aiQuota} ({usd(o.costUsdMicros)})</td>
              <td>{o.lastActivityAt ? fmtTime(o.lastActivityAt) : "Sin actividad"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows?.length === 0 && <p className="mt-3 text-sm text-ink-soft">Todavía no hay espacios de trabajo.</p>}
    </Card>
  );
}

function OrgDetail({ d, onRefresh, onClose }: { d: OrgSnapshot; onRefresh: () => void; onClose: () => void }) {
  return (
    <Card className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{d.name}</h2>
          <p className="text-sm text-ink-soft">Creado {fmtTime(d.createdAt)}{d.settings ? `, zona ${d.settings.timezone}, idioma ${d.settings.defaultLanguage}` : ""}. Solo lectura, foto del momento en que lo abriste (queda registrado).</p>
        </div>
        <div className="flex gap-2">
          <Btn variant="ghost" onClick={onRefresh}>Actualizar</Btn>
          <Btn variant="ghost" onClick={onClose}>Cerrar</Btn>
        </div>
      </div>
      <Section title="Cuentas conectadas" empty="Sin cuentas." rows={d.accounts.map((a) => [a.channel === "whatsapp" ? "WhatsApp" : "Instagram", a.username, a.status, a.webhookSubscribed ? "Webhook activo" : "Sin webhook"])} />
      <Section title="Miembros" empty="Sin miembros." rows={d.members.map((m) => [m.userId, m.role])} />
      <Section title="Automatizaciones" empty="Sin automatizaciones." rows={d.automations.map((a) => [a.name, a.type, a.enabled ? "Activa" : "Apagada", `${a.firedCount} envíos`])} />
      <Section title="Conversaciones recientes" empty="Sin conversaciones." rows={d.conversations.map((c) => [c.contact, c.mode === "human" ? "Persona" : "Bot", c.preview, fmtTime(c.lastMessageAt)])} />
      <Section title="Uso" empty="Sin uso." rows={d.usage.map((u) => [u.month, `${u.aiReplies} respuestas de IA`, `${u.outboundMessages} mensajes enviados`, usd(u.costUsdMicros)])} />
      <Section title="Fallos recientes" empty="Sin fallos." rows={d.failedRuns.map((r) => [fmtTime(r.at), r.error])} />
    </Card>
  );
}

function Section({ title, rows, empty }: { title: string; rows: string[][]; empty: string }) {
  return (
    <section>
      <h3 className="mb-1.5 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? <p className="text-sm text-ink-soft">{empty}</p> : (
        <ul className="divide-y divide-line rounded-md border border-line text-sm">
          {rows.map((r, i) => <li key={i} className="flex flex-wrap gap-x-4 gap-y-0.5 px-3 py-1.5">{r.map((c, j) => <span key={j} className={j === 0 ? "font-medium" : "text-ink-soft"}>{c}</span>)}</li>)}
        </ul>
      )}
    </section>
  );
}

function Admins() {
  const admins = useQuery(api.platform.listAdmins);
  const grant = useMutation(api.platform.grantAdmin);
  const revoke = useMutation(api.platform.revokeAdmin);
  const [email, setEmail] = useState("");
  const { runOk, run, busy, error } = useRun();
  return (
    <Card>
      <h2 className="text-lg font-semibold">Superadministradores</h2>
      <p className="mt-1 text-sm text-ink-soft">Quien aparezca aquí puede ver todos los espacios y cambiar la IA del servicio. La persona activa el acceso al iniciar sesión con ese correo.</p>
      <ul className="mt-3 divide-y divide-line rounded-md border border-line text-sm">
        {(admins ?? []).map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <span>{a.email} <span className="text-ink-soft">{a.active ? "Activo" : "Pendiente de activar"}</span></span>
            <Btn variant="ghost" onClick={() => confirm(`¿Quitar el acceso de ${a.email}?`) && run(() => revoke({ id: a.id }))}>Quitar</Btn>
          </li>
        ))}
      </ul>
      <form className="mt-3 flex max-w-md items-end gap-2" onSubmit={async (e) => { e.preventDefault(); if (await runOk(() => grant({ email }))) setEmail(""); }}>
        <div className="flex-1"><Field label="Dar acceso a otro correo"><input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field></div>
        <Btn type="submit" disabled={busy}>Dar acceso</Btn>
      </form>
      <div className="mt-2"><ErrorText error={error} /></div>
    </Card>
  );
}

function Audit() {
  const rows = useQuery(api.platform.recentAudit);
  return (
    <Card>
      <h2 className="text-lg font-semibold">Actividad de superadministradores</h2>
      {(rows ?? []).length === 0 ? <p className="mt-2 text-sm text-ink-soft">Todavía no hay actividad registrada.</p> : (
        <ul className="mt-3 divide-y divide-line rounded-md border border-line text-sm">
          {(rows ?? []).map((a) => <li key={a.id} className="flex flex-wrap gap-x-4 px-3 py-1.5"><span className="font-medium">{a.action}</span><span className="text-ink-soft">{a.detail ?? ""}</span><span className="ml-auto text-ink-faint">{fmtTime(a.at)}</span></li>)}
        </ul>
      )}
    </Card>
  );
}
