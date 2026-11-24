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
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="flex flex-wrap items-center gap-4 border-b bg-white px-4 py-2">
        <span className="font-semibold">vendebot</span>
        <select className="rounded border px-2 py-1 text-sm" value={org.orgId}
          onChange={(e) => (e.target.value === "__new" ? nav("/new") : setOrgId(e.target.value as typeof org.orgId))}>
          {orgs.map((o) => <option key={o.orgId} value={o.orgId}>{o.name}</option>)}
          <option value="__new">+ Nuevo espacio…</option>
        </select>
        <nav className="flex flex-wrap gap-3 text-sm">
          {NAV.filter((n) => !n.admin || isAdmin).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"} className={({ isActive }) => (isActive ? "font-semibold underline" : "text-zinc-600")}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <button className="ml-auto text-sm text-zinc-600 underline" onClick={() => authClient.signOut()}>Salir</button>
      </header>
      <main className="mx-auto max-w-5xl p-4"><Outlet /></main>
    </div>
  );
}
