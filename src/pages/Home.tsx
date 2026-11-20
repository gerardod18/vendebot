import { useQuery } from "convex/react";
import { Link } from "react-router";
import { api } from "../../convex/_generated/api";
import { Card, PageTitle } from "../components/ui";
import { useOrg } from "../lib/org";

/** Dashboard + guided setup checklist (the onboarding for non-technical owners). */
export function Home() {
  const { org } = useOrg();
  const accounts = useQuery(api.accounts.list, { orgId: org.orgId });
  const automations = useQuery(api.automations.list, { orgId: org.orgId });
  const knowledge = useQuery(api.knowledge.list, { orgId: org.orgId });
  const settings = useQuery(api.orgs.getSettings, { orgId: org.orgId });
  const user = useQuery(api.auth.getCurrentUser);

  const steps = [
    { done: true, label: "Crear tu espacio de trabajo", to: "/", help: "Listo." },
    { done: (accounts ?? []).some((a) => a.status === "active"), label: "Conectar tu cuenta de Instagram", to: "/accounts", help: "Necesitas una cuenta profesional (Business o Creator)." },
    { done: (automations ?? []).length > 0, label: "Crear tu primera respuesta automática", to: "/automations", help: "Por ejemplo: un mensaje de bienvenida o una respuesta a la palabra «precio»." },
    { done: (knowledge ?? []).length > 0, label: "Enseñarle a la IA sobre tu negocio", to: "/knowledge", help: "Horarios, envíos, formas de pago, preguntas frecuentes." },
    { done: Boolean(settings?.aiInstructions), label: "Escribir cómo debe hablar tu asistente", to: "/settings", help: "Tono, qué vendes y qué NO debe prometer." },
  ];
  const done = steps.filter((s) => s.done).length;

  return (
    <>
      <PageTitle title={`Hola${user?.name ? `, ${user.name}` : ""}`} />
      <Card>
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Configuración inicial</h2>
          <span className="text-sm text-zinc-500">{done}/{steps.length}</span>
        </div>
        <div className="mt-2 h-2 rounded bg-zinc-100"><div className="h-2 rounded bg-emerald-500" style={{ width: `${(done / steps.length) * 100}%` }} /></div>
        <ul className="mt-3 divide-y">
          {steps.map((s) => (
            <li key={s.label} className="flex items-start gap-3 py-2">
              <span className={`mt-0.5 ${s.done ? "text-emerald-600" : "text-zinc-300"}`}>{s.done ? "✔" : "○"}</span>
              <div className="flex-1">
                <Link to={s.to} className="text-sm font-medium underline">{s.label}</Link>
                <p className="text-xs text-zinc-500">{s.help}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
