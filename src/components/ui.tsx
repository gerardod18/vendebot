import {
  Children, cloneElement, isValidElement, useId, useState,
  type ButtonHTMLAttributes, type ReactElement, type ReactNode,
} from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-line bg-surface p-4 ${className}`}>{children}</div>;
}

export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children}
    </div>
  );
}

type Variant = "primary" | "ghost" | "danger";
const BTN: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-strong",
  ghost: "border border-line-strong bg-surface text-ink hover:bg-ground",
  danger: "bg-danger text-white hover:opacity-90",
};
export function Btn({ variant = "primary", className = "", type = "button", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button {...p} type={type}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${BTN[variant]} ${className}`} />
  );
}

export const inputCls =
  "w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint aria-[invalid=true]:border-danger";

/**
 * A labelled form field: persistent top label, optional flag, helper text under the label, error under the field.
 * The label, helper and error are wired to the control with htmlFor / aria-describedby.
 */
export function Field({
  label, hint, error, optional, children,
}: { label: string; hint?: string; error?: string | null; optional?: boolean; children: ReactNode }) {
  const id = useId();
  const hintId = `${id}-hint`, errId = `${id}-err`;
  const kids = Children.toArray(children);
  const single = kids.length === 1 && isValidElement(kids[0]);
  const control = single
    ? cloneElement(kids[0] as ReactElement<Record<string, unknown>>, {
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": [hint ? hintId : "", error ? errId : ""].filter(Boolean).join(" ") || undefined,
      })
    : children; // several controls (e.g. a time range): the label names the group instead
  const labelText = (
    <>
      {label}
      {optional && <span className="ml-1.5 font-normal text-ink-faint">(opcional)</span>}
    </>
  );
  return (
    <div className="space-y-1.5" role={single ? undefined : "group"} aria-labelledby={single ? undefined : `${id}-label`}>
      {single
        ? <label htmlFor={id} className="block text-sm font-medium text-ink">{labelText}</label>
        : <span id={`${id}-label`} className="block text-sm font-medium text-ink">{labelText}</span>}
      {hint && <p id={hintId} className="text-xs text-ink-soft">{hint}</p>}
      {control}
      {error && <p id={errId} role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  return error ? <p role="alert" className="rounded-md bg-danger-wash px-3 py-2 text-sm text-danger">{error}</p> : null;
}

export function Notice({ tone = "ok", children }: { tone?: "ok" | "warn"; children: ReactNode }) {
  const cls = tone === "ok" ? "bg-ok-wash text-ok" : "bg-warn-wash text-warn";
  return <p role="status" className={`mb-3 rounded-md px-3 py-2 text-sm ${cls}`}>{children}</p>;
}

/** Accessible on/off switch. */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-brand" : "bg-line-strong"}`}>
      <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : "translate-x-1"}`} />
    </button>
  );
}

export type Channel = "instagram" | "whatsapp";
export function ChannelBadge({ channel }: { channel: Channel }) {
  const ig = channel === "instagram";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${ig ? "border-instagram/30 text-instagram" : "border-whatsapp/30 text-whatsapp"}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${ig ? "bg-instagram" : "bg-whatsapp"}`} />
      {ig ? "Instagram" : "WhatsApp"}
    </span>
  );
}

/** Wraps an async mutation call with busy/error state. Convex errors are shown without the stack prefix. */
export function useRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true); setError(null);
    try { return await fn(); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0]);
    } finally { setBusy(false); }
    return undefined;
  }
  /** Like `run` but returns true on success (use for mutations that return void). */
  async function runOk(fn: () => Promise<unknown>): Promise<boolean> {
    let ok = false;
    await run(async () => { await fn(); ok = true; });
    return ok;
  }
  return { run, runOk, busy, error, setError };
}

export const fmtTime = (ms: number) => new Date(ms).toLocaleString("es", { dateStyle: "short", timeStyle: "short" });
