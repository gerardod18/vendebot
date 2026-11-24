import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { LIBRARY, type LibraryLevel } from "../../convex/engine/library";
import { useOrg } from "../lib/org";
import { Btn, ChannelBadge, ErrorText, useRun, type Channel } from "./ui";

type Account = { accountId: Id<"igAccounts">; username: string; channel: Channel; status: string };

const LEVEL_TONE: Record<LibraryLevel, string> = {
  Básica: "bg-ok-wash text-ok",
  Intermedia: "bg-brand-wash text-brand",
  Avanzada: "bg-warn-wash text-warn",
  Experta: "bg-danger-wash text-danger",
};
const TRIGGER_TEXT: Record<string, string> = { welcome: "Primera vez que escriben", keyword: "Palabra clave", default: "Cuando nada más aplica", comment: "Comentario en una publicación" };

/** Ready-made sales flows: pick one and an account; it is created enabled and opens in the flow tab. */
export function LibraryGallery({ accounts, onDone }: { accounts: Account[]; onDone: (id: Id<"triggers">) => void }) {
  const { org } = useOrg();
  const create = useMutation(api.automations.createFromLibrary);
  const { run, busy, error } = useRun();
  const active = accounts.filter((a) => a.status === "active");
  const [account, setAccount] = useState<string>(active[0]?.accountId ?? "");
  const current = active.find((a) => a.accountId === account);

  if (active.length === 0) return <p className="text-sm text-ink-soft">Primero conecta una cuenta de Instagram o WhatsApp en la sección Cuentas.</p>;

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-ink-soft">
        Flujos de venta listos para usar, del más sencillo al más completo. Se crean con textos de ejemplo de una cafetería: después los adaptas a tu negocio en la pestaña Flujo.
      </p>
      {active.length > 1 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Crear en la cuenta</legend>
          <div className="flex flex-wrap gap-2">
            {active.map((a) => (
              <label key={a.accountId} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 ${account === a.accountId ? "border-brand bg-brand-wash" : "border-line"}`}>
                <input type="radio" name="lib-account" checked={account === a.accountId} onChange={() => setAccount(a.accountId)} />
                <ChannelBadge channel={a.channel} /><span className="text-sm">{a.channel === "whatsapp" ? a.username : `@${a.username}`}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <ErrorText error={error} />
      <ul className="grid gap-3 xl:grid-cols-2">
        {LIBRARY.map((f) => {
          const supported = current ? f.channels.includes(current.channel) : true;
          return (
            <li key={f.id} className="flex flex-col rounded-lg border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-semibold">{f.title}</h3>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL_TONE[f.level]}`}>{f.level}</span>
              </div>
              <p className="mt-1 text-sm text-ink-soft">{f.summary}</p>
              <p className="mt-2 text-xs text-ink-faint">
                Empieza con: {TRIGGER_TEXT[f.trigger.type]}{f.trigger.keywords ? ` (${f.trigger.keywords.join(", ")})` : ""}
              </p>
              <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm">{f.steps.map((s) => <li key={s}>{s}</li>)}</ol>
              <p className="mt-2 text-xs text-ink-faint">{f.graph.nodes.length} bloques</p>
              <div className="mt-3 flex items-center gap-2 pt-1">
                <Btn disabled={busy || !supported} onClick={async () => {
                  const r = await run(() => create({ orgId: org.orgId, libraryId: f.id, igAccountId: account as Id<"igAccounts"> }));
                  if (r) onDone(r.triggerId);
                }}>Usar este flujo</Btn>
                {!supported && <span className="text-xs text-ink-soft">No disponible para WhatsApp: los comentarios son solo de Instagram.</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
