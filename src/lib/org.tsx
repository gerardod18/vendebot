import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export type OrgInfo = { orgId: Id<"orgs">; name: string; slug: string; role: "owner" | "admin" | "agent" };
type Ctx = { org: OrgInfo; orgs: OrgInfo[]; setOrgId: (id: Id<"orgs">) => void; isAdmin: boolean };
const OrgCtx = createContext<Ctx | null>(null);
const KEY = "vendebot.orgId";

function readStored(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

/** Loads the user's workspaces and tracks the selected one. Renders `empty` when the user has none. */
export function OrgProvider({ children, empty }: { children: ReactNode; empty: ReactNode }) {
  const orgs = useQuery(api.orgs.listMine) as OrgInfo[] | undefined;
  const [selected, setSelected] = useState<string | null>(readStored);
  useEffect(() => {
    try { if (selected) localStorage.setItem(KEY, selected); } catch { /* storage unavailable */ }
  }, [selected]);
  const value = useMemo<Ctx | null>(() => {
    if (!orgs || orgs.length === 0) return null;
    const org = orgs.find((o) => o.orgId === selected) ?? orgs[0];
    return { org, orgs, setOrgId: (id) => setSelected(id), isAdmin: org.role !== "agent" };
  }, [orgs, selected]);
  if (orgs === undefined) return <div className="p-8 text-sm text-zinc-500">Cargando…</div>;
  if (!value) return <>{empty}</>;
  return <OrgCtx.Provider value={value}>{children}</OrgCtx.Provider>;
}

export function useOrg(): Ctx {
  const c = useContext(OrgCtx);
  if (!c) throw new Error("useOrg outside OrgProvider");
  return c;
}
