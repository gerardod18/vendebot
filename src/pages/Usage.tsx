import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Card, PageTitle } from "../components/ui";
import { useOrg } from "../lib/org";

const usd = (micros: number) => `$${(micros / 1e6).toFixed(4)}`;

export function Usage() {
  const { org } = useOrg();
  const u = useQuery(api.usage.summary, { orgId: org.orgId });
  if (!u) return <p className="text-sm text-zinc-500">Cargando…</p>;
  const pct = u.unlimited ? 0 : Math.min(100, (u.current.aiReplies / Math.max(1, u.aiMonthlyQuota)) * 100);
  return (
    <>
      <PageTitle title={`Uso de ${u.month}`} />
      <div className="grid gap-3 md:grid-cols-3">
        <Card><p className="text-xs text-zinc-500">Respuestas de IA</p><p className="text-2xl font-semibold">{u.current.aiReplies}{!u.unlimited && <span className="text-sm font-normal text-zinc-500"> / {u.aiMonthlyQuota}</span>}</p>
          {u.unlimited ? <p className="text-xs text-zinc-500">Ilimitado: usas tu propia clave de API.</p> : <div className="mt-2 h-2 rounded bg-zinc-100"><div className={`h-2 rounded ${pct > 90 ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} /></div>}</Card>
        <Card><p className="text-xs text-zinc-500">Mensajes enviados</p><p className="text-2xl font-semibold">{u.current.outboundMessages}</p></Card>
        <Card><p className="text-xs text-zinc-500">Costo estimado de IA</p><p className="text-2xl font-semibold">{usd(u.current.costUsdMicros)}</p><p className="text-xs text-zinc-500">Plan {u.plan}. Modelos desconocidos cuentan $0.</p></Card>
      </div>
      <Card className="mt-4">
        <h2 className="mb-2 font-medium">Historial</h2>
        <table className="w-full text-sm"><thead><tr className="text-left text-xs text-zinc-500"><th>Mes</th><th>IA</th><th>Mensajes</th><th>Costo</th></tr></thead>
          <tbody>{u.history.map((h) => <tr key={h.month}><td>{h.month}</td><td>{h.aiReplies}</td><td>{h.outboundMessages}</td><td>{usd(h.costUsdMicros)}</td></tr>)}</tbody></table>
      </Card>
    </>
  );
}
