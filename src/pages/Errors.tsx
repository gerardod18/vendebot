import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Card, PageTitle, fmtTime } from "../components/ui";
import { useOrg } from "../lib/org";

const HELP: Record<string, string> = {
  window_closed: "Pasaron más de 24 h desde el último mensaje del cliente.",
  account_not_active: "La cuenta de Instagram está desconectada o expirada.",
  ai_error: "La IA falló; la conversación se pasó a una persona.",
};

export function Errors() {
  const { org } = useOrg();
  const runs = useQuery(api.admin.failedRuns, { orgId: org.orgId });
  const events = useQuery(api.admin.failedEvents, { orgId: org.orgId });
  return (
    <>
      <PageTitle title="Errores recientes" />
      <Card className="mb-4">
        <h2 className="mb-2 font-medium">Automatizaciones que fallaron</h2>
        {runs?.length === 0 && <p className="text-sm text-ink-soft">Sin errores 🎉</p>}
        <ul className="divide-y text-sm">{(runs ?? []).map((r) => (
          <li key={r.runId} className="py-2"><span className="font-mono text-xs">{r.error.split(":")[0]}</span> · {r.contact ?? "?"} · {fmtTime(r.at)}
            {HELP[r.error] && <p className="text-xs text-ink-soft">{HELP[r.error]}</p>}</li>))}</ul>
      </Card>
      <Card>
        <h2 className="mb-2 font-medium">Eventos con error</h2>
        {events?.length === 0 && <p className="text-sm text-ink-soft">Sin errores.</p>}
        <ul className="divide-y text-sm">{(events ?? []).map((e, i) => <li key={i} className="py-2">{e.type} · {e.error} · {fmtTime(e.at)}</li>)}</ul>
      </Card>
    </>
  );
}
