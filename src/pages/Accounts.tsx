import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "react-router";
import { api } from "../../convex/_generated/api";
import { Btn, Card, ErrorText, Field, PageTitle, fmtTime, inputCls, useRun } from "../components/ui";
import { useOrg } from "../lib/org";

const MESSAGES: Record<string, string> = {
  denied: "Cancelaste la conexión.", state: "La conexión expiró. Inténtalo de nuevo.", config: "El servidor no está configurado para Instagram.",
  noaccount: "Meta no devolvió ninguna cuenta profesional de Instagram.", taken: "Esa cuenta ya está conectada a otro espacio de trabajo.", failed: "No pudimos conectar la cuenta. Inténtalo de nuevo.",
};

export function Accounts() {
  const { org, isAdmin } = useOrg();
  const accounts = useQuery(api.accounts.list, { orgId: org.orgId });
  const start = useMutation(api.accounts.startConnect);
  const disconnect = useMutation(api.accounts.disconnect);
  const connectWa = useMutation(api.accounts.connectWhatsApp);
  const [wa, setWa] = useState({ phoneNumberId: "", wabaId: "", accessToken: "" });
  const [showWa, setShowWa] = useState(false);
  const { run, busy, error } = useRun();
  const [params] = useSearchParams();
  const err = params.get("error");

  async function connect() {
    const r = await run(() => start({ orgId: org.orgId }));
    if (r) window.location.href = r.url;
  }

  return (
    <>
      <PageTitle title="Cuentas conectadas">
        {isAdmin && (
          <div className="flex gap-2">
            <Btn onClick={connect} disabled={busy}>Conectar Instagram</Btn>
            <Btn variant="ghost" onClick={() => setShowWa(!showWa)}>Conectar WhatsApp</Btn>
          </div>
        )}
      </PageTitle>
      {isAdmin && showWa && (
        <Card className="mb-3 space-y-3">
          <p className="text-sm text-ink-soft">Pega los datos de WhatsApp Cloud API (Meta → tu app → WhatsApp → API Setup). Para la demo sirve el token temporal; en producción usa un token permanente de usuario del sistema.</p>
          <Field label="Phone number ID"><input className={inputCls} value={wa.phoneNumberId} onChange={(e) => setWa({ ...wa, phoneNumberId: e.target.value })} /></Field>
          <Field label="WhatsApp Business Account ID"><input className={inputCls} value={wa.wabaId} onChange={(e) => setWa({ ...wa, wabaId: e.target.value })} /></Field>
          <Field label="Access token"><input className={inputCls} type="password" autoComplete="off" value={wa.accessToken} onChange={(e) => setWa({ ...wa, accessToken: e.target.value })} /></Field>
          <Btn disabled={busy || !wa.phoneNumberId || !wa.wabaId || !wa.accessToken}
            onClick={async () => { if (await run(() => connectWa({ orgId: org.orgId, ...wa }))) { setWa({ phoneNumberId: "", wabaId: "", accessToken: "" }); setShowWa(false); } }}>
            Guardar y verificar
          </Btn>
        </Card>
      )}
      {params.get("connected") && <p className="mb-3 rounded bg-ok-wash p-2 text-sm text-ok">¡Cuenta conectada!</p>}
      {err && <p className="mb-3 rounded bg-danger-wash p-2 text-sm text-danger">{MESSAGES[err] ?? "Error al conectar."}</p>}
      <ErrorText error={error} />
      <div className="space-y-2">
        {(accounts ?? []).map((a) => (
          <Card key={a.accountId} className="flex items-center gap-3">
            <div className="flex-1">
              <p className="font-medium">{a.channel === "whatsapp" ? `WhatsApp ${a.username}` : `@${a.username}`}</p>
              <p className="text-xs text-ink-soft">
                {a.status === "active" ? "Activa" : a.status === "expired" ? "Expirada: reconecta" : "Desconectada"}
                {a.status === "active" && a.channel !== "whatsapp" && ` · token hasta ${fmtTime(a.tokenExpiresAt)}`}
                {a.status === "active" && !a.webhookSubscribed && " · ⚠ sin suscripción a mensajes"}
              </p>
            </div>
            {isAdmin && a.status !== "active" && <Btn variant="ghost" onClick={connect}>Reconectar</Btn>}
            {isAdmin && a.status !== "revoked" && (
              <Btn variant="danger" onClick={() => confirm("¿Desconectar esta cuenta? Se desactivarán sus automatizaciones.") && run(() => disconnect({ orgId: org.orgId, accountId: a.accountId }))}>Desconectar</Btn>
            )}
          </Card>
        ))}
        {accounts?.length === 0 && <p className="text-sm text-ink-soft">Aún no has conectado ninguna cuenta.</p>}
      </div>
    </>
  );
}
