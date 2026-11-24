import { NavLink, Outlet, useNavigate } from "react-router";
import { authClient } from "../lib/auth-client";
import { useOrg } from "../lib/org";

const NAV: { to: string; label: string; admin?: boolean }[] = [
  { to: "/", label: "Inicio" },
  { to: "/inbox", label: "Bandeja" },
  { to: "/automations", label: "Automatizaciones" },
  { to: "/accounts", label: "Cuentas" },
  { to: "/knowledge", label: "Conocimiento" },
  { to: "/usage", label: "Uso" },
  { to: "/settings", label: "Ajustes" },
  { to: "/errors", label: "Errores", admin: true },
];

export function Shell() {
  const { org, orgs, setOrgId, isAdmin } = useOrg();
  const nav = useNavigate();
  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-line bg-surface md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between gap-3 px-4 py-3 md:block">
          <span className="text-lg font-bold tracking-tight">vendebot</span>
          <div className="md:mt-3">
            <label htmlFor="workspace" className="sr-only">Espacio de trabajo</label>
            <select id="workspace" className="w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm" value={org.orgId}
              onChange={(e) => (e.target.value === "__new" ? nav("/new") : setOrgId(e.target.value as typeof org.orgId))}>
              {orgs.map((o) => <option key={o.orgId} value={o.orgId}>{o.name}</option>)}
              <option value="__new">Nuevo espacio…</option>
            </select>
          </div>
        </div>
        <nav aria-label="Principal" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible md:pb-0">
          {NAV.filter((n) => !n.admin || isAdmin).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"}
              className={({ isActive }) => `whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${isActive ? "bg-brand-wash text-brand" : "text-ink-soft hover:bg-ground"}`}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden px-4 py-3 md:absolute md:bottom-0 md:block md:w-56">
          <button className="text-sm text-ink-soft underline-offset-2 hover:underline" onClick={() => authClient.signOut()}>Salir</button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-8"><Outlet /></main>
    </div>
  );
}
