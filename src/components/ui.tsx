import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border bg-white p-4 shadow-sm ${className}`}>{children}</div>;
}

export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h1 className="text-xl font-semibold">{title}</h1>
      {children}
    </div>
  );
}

export function Btn({ variant = "primary", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const v = variant === "primary" ? "bg-zinc-900 text-white" : variant === "danger" ? "bg-red-600 text-white" : "border bg-white text-zinc-800";
  return <button {...p} className={`rounded px-3 py-1.5 text-sm disabled:opacity-50 ${v} ${className}`} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      {children}
      {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export const inputCls = "w-full rounded border px-3 py-2 text-sm";

export function ErrorText({ error }: { error: string | null }) {
  return error ? <p className="text-sm text-red-600">{error}</p> : null;
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
