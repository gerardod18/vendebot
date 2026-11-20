import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "react-router";
import { api } from "../../convex/_generated/api";
import { Btn, Card, ErrorText, PageTitle, fmtTime, useRun } from "../components/ui";
import { useOrg } from "../lib/org";

const MESSAGES: Record<string, string> = {
  denied: "Cancelaste la conexión.", state: "La conexión expiró. Inténtalo de nuevo.", config: "El servidor no está configurado para Instagram.",
  taken: "Esa cuenta ya está conectada a otro espacio de trabajo.", failed: "No pudimos conectar la cuenta. Inténtalo de nuevo.",
};

export function Accounts() {
  const { org, isAdmin } = useOrg();
  const accounts = useQuery(api.accounts.list, { orgId: org.orgId });
  const start = useMutation(api.accounts.startConnect);
  const disconnect = useMutation(api.accounts.disconnect);
  const { run, busy, error } = useRun();
  const [params] = useSearchParams();
  const err = params.get("error");

  async function connect() {
    const r = await run(() => start({ orgId: org.orgId }));
    if (r) window.location.href = r.url;
  }

  return (
    <>
      <PageTitle title="Cuentas de Instagram">{isAdmin && <Btn onClick={connect} disabled={busy}>Conectar Instagram</Btn>}</PageTitle>
      {params.get("connected") && <p className="mb-3 rounded bg-emerald-50 p-2 text-sm text-emerald-800">¡Cuenta conectada!</p>}
      {err && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">{MESSAGES[err] ?? "Error al conectar."}</p>}
      <ErrorText error={error} />
      <div className="space-y-2">
        {(accounts ?? []).map((a) => (
          <Card key={a.accountId} className="flex items-center gap-3">
            <div className="flex-1">
              <p className="font-medium">@{a.username}</p>
              <p className="text-xs text-zinc-500">
                {a.status === "active" ? "Activa" : a.status === "expired" ? "Expirada: reconecta" : "Desconectada"}
                {a.status === "active" && ` · token hasta ${fmtTime(a.tokenExpiresAt)}`}
                {a.status === "active" && !a.webhookSubscribed && " · ⚠ sin suscripción a mensajes"}
              </p>
            </div>
            {isAdmin && a.status !== "active" && <Btn variant="ghost" onClick={connect}>Reconectar</Btn>}
            {isAdmin && a.status !== "revoked" && (
              <Btn variant="danger" onClick={() => confirm("¿Desconectar esta cuenta? Se desactivarán sus automatizaciones.") && run(() => disconnect({ orgId: org.orgId, accountId: a.accountId }))}>Desconectar</Btn>
            )}
          </Card>
        ))}
        {accounts?.length === 0 && <p className="text-sm text-zinc-500">Aún no has conectado ninguna cuenta.</p>}
      </div>
    </>
  );
}
