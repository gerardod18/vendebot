import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { AutomationForm, GROUP_ORDER, TEMPLATES, TYPE_TO_KEY } from "../components/AutomationForm";
import { FlowEditor } from "../components/flow/FlowEditor";
import { LibraryGallery } from "../components/LibraryGallery";
import { Btn, ChannelBadge, ErrorText, Notice, PageTitle, Toggle, useRun, type Channel } from "../components/ui";
import { useOrg } from "../lib/org";

/** Keyed by workspace: switching workspace drops the selection and every form, so no stale account or trigger id is ever sent. */
export function Automations() {
  const { org } = useOrg();
  return <AutomationsInner key={org.orgId} />;
}

function AutomationsInner() {
  const { org, isAdmin } = useOrg();
  const list = useQuery(api.automations.list, { orgId: org.orgId });
  const accountRows = useQuery(api.accounts.list, { orgId: org.orgId });
  const setEnabled = useMutation(api.automations.setEnabled);
  const [selected, setSelected] = useState<Id<"triggers"> | "new" | null>(null);
  const [newTab, setNewTab] = useState<"library" | "scratch">("library");
  const { run, error } = useRun();

  const accounts = useMemo(
    () => (accountRows ?? []).map((a) => ({ accountId: a.accountId, username: a.username, channel: a.channel as Channel, status: a.status })),
    [accountRows],
  );
  const accountOf = (id: Id<"igAccounts">) => accounts.find((a) => a.accountId === id);

  const groups = GROUP_ORDER.map((k) => ({ key: k, items: (list ?? []).filter((a) => TYPE_TO_KEY[a.type] === k) })).filter((g) => g.items.length > 0);

  return (
    <>
      <PageTitle title="Automatizaciones">{isAdmin && <Btn onClick={() => setSelected("new")}>Nueva automatización</Btn>}</PageTitle>
      <ErrorText error={error} />
      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <nav aria-label="Automatizaciones" className="space-y-5">
          {list?.length === 0 && (
            <p className="text-sm text-ink-soft">Todavía no tienes automatizaciones. Crea la primera con «Nueva automatización»: una bienvenida o una respuesta a la palabra «precio» funcionan bien.</p>
          )}
          {groups.map((g) => (
            <section key={g.key} aria-labelledby={`g-${g.key}`}>
              <h2 id={`g-${g.key}`} className="mb-1.5 px-1 text-sm font-semibold text-ink-soft">{TEMPLATES[g.key].group}</h2>
              <ul className="space-y-1.5">
                {g.items.map((a) => {
                  const acc = accountOf(a.igAccountId);
                  const on = selected === a.triggerId;
                  return (
                    <li key={a.triggerId} className={`flex items-center gap-2 rounded-lg border bg-surface pr-3 ${on ? "border-brand ring-1 ring-brand" : "border-line"}`}>
                      <button type="button" onClick={() => setSelected(a.triggerId)} aria-current={on} className="min-w-0 flex-1 px-3 py-2.5 text-left">
                        <span className="block truncate text-sm font-medium">{a.name}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft">
                          {acc && <ChannelBadge channel={acc.channel} />}
                          {a.config?.keywords?.length ? <span className="truncate">{a.config.keywords.join(", ")}</span> : null}
                          <span>{a.firedCount} {a.firedCount === 1 ? "envío" : "envíos"}</span>
                        </span>
                      </button>
                      {isAdmin && <Toggle checked={a.enabled} label={`${a.enabled ? "Desactivar" : "Activar"} ${a.name}`}
                        onChange={(v) => run(() => setEnabled({ orgId: org.orgId, triggerId: a.triggerId, enabled: v }))} />}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </nav>

        <section aria-live="polite" className="min-w-0">
          {selected === "new" && (
            <div className="rounded-lg border border-line bg-surface p-5">
              <h2 className="mb-3 text-lg font-semibold">Nueva automatización</h2>
              <div role="tablist" aria-label="Cómo empezar" className="mb-4 flex gap-1 border-b border-line">
                {([["library", "Flujos de venta listos"], ["scratch", "Desde cero"]] as const).map(([k, label]) => (
                  <button key={k} role="tab" aria-selected={newTab === k} type="button" onClick={() => setNewTab(k)}
                    className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${newTab === k ? "border-brand text-brand" : "border-transparent text-ink-soft"}`}>{label}</button>
                ))}
              </div>
              {newTab === "library"
                ? <LibraryGallery key={org.orgId} accounts={accounts} onDone={(id) => setSelected(id)} />
                : <AutomationForm key={org.orgId} accounts={accounts} onDone={(id) => setSelected(id ?? null)} />}
            </div>
          )}
          {selected && selected !== "new" && <Detail key={selected} triggerId={selected} accounts={accounts} onGone={() => setSelected(null)} />}
          {!selected && list && list.length > 0 && (
            <div className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-ink-soft">Elige una automatización para ver cómo responde y editarla.</div>
          )}
        </section>
      </div>
    </>
  );
}

function Detail({ triggerId, accounts, onGone }: { triggerId: Id<"triggers">; accounts: { accountId: Id<"igAccounts">; username: string; channel: Channel; status: string }[]; onGone: () => void }) {
  const { org, isAdmin } = useOrg();
  const a = useQuery(api.automations.get, { orgId: org.orgId, triggerId });
  const saveGraph = useMutation(api.automations.saveGraph);
  const remove = useMutation(api.automations.remove);
  const [tab, setTab] = useState<"flow" | "settings">("flow");
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  /** Version the open editor started from: a save on top of any other version is refused by the server. */
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const { run, runOk, busy, error } = useRun();

  if (a === undefined) return <p className="text-sm text-ink-soft">Cargando…</p>;
  if (a === null) return <p className="text-sm text-ink-soft">Esta automatización ya no existe.</p>;
  const acc = accounts.find((x) => x.accountId === a.igAccountId);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{a.name}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
            {acc && <ChannelBadge channel={acc.channel} />}
            <span>{TEMPLATES[TYPE_TO_KEY[a.type]].title}</span>
            <span>Versión {a.version}</span>
          </p>
        </div>
        {isAdmin && (
          <Btn variant="ghost" onClick={async () => { if (confirm("¿Eliminar esta automatización?")) { if (await runOk(() => remove({ orgId: org.orgId, triggerId }))) onGone(); } }}>Eliminar</Btn>
        )}
      </header>

      <div role="tablist" aria-label="Secciones" className="flex gap-1 border-b border-line">
        {([["flow", "Flujo"], ["settings", "Ajustes"]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => { setTab(k); setSaved(false); }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? "border-brand text-brand" : "border-transparent text-ink-soft"}`}>{label}</button>
        ))}
      </div>

      {saved && <Notice>Cambios guardados. La nueva versión ya responde a tus clientes.</Notice>}

      {tab === "flow" && (
        <>
          {isAdmin && !editing && a.graph && <Btn onClick={() => { setBaseVersion(a.version); setEditing(true); }}>Editar flujo</Btn>}
          {a.graph ? (
            <FlowEditor key={`${a.version}:${editing}`} graph={a.graph} layout={a.layout} editing={editing && isAdmin} saving={busy} error={error} channel={acc?.channel}
              onCancel={() => setEditing(false)}
              onSave={async (graph, layout) => {
                const r = await run(() => saveGraph({ orgId: org.orgId, triggerId, graph, layout, expectedVersion: baseVersion ?? a.version }));
                if (r) { setEditing(false); setSaved(true); }
              }} />
          ) : <p className="text-sm text-ink-soft">Esta automatización todavía no tiene un flujo.</p>}
        </>
      )}

      {tab === "settings" && (
        <div className="rounded-lg border border-line bg-surface p-5">
          <AutomationForm key={a.version} accounts={accounts} existing={{ ...a, templateKey: a.templateKey }} onDone={() => setSaved(true)} />
        </div>
      )}
    </div>
  );
}
