import { useRef } from "react";
import { VARIABLES } from "../lib/flow";
import { Field, inputCls } from "./ui";

/** Textarea with buttons that insert variables like {{first_name}} at the cursor. */
export function TextWithVars({
  label, hint, value, onChange, rows = 3, maxLength, error, optional, onBlur,
}: {
  label: string; hint?: string; value: string; onChange: (v: string) => void; rows?: number; maxLength?: number;
  error?: string | null; optional?: boolean; onBlur?: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  function insert(key: string) {
    const el = ref.current;
    const token = `{{${key}}}`;
    const at = el ? [el.selectionStart, el.selectionEnd] : [value.length, value.length];
    const next = value.slice(0, at[0]) + token + value.slice(at[1]);
    onChange(next);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at[0] + token.length, at[0] + token.length); });
  }
  return (
    <div className="space-y-2">
      <Field label={label} hint={hint} error={error} optional={optional}>
        <textarea ref={ref} className={inputCls} rows={rows} value={value} maxLength={maxLength} onBlur={onBlur}
          onChange={(e) => onChange(e.target.value)} />
      </Field>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-ink-soft">Insertar dato del cliente:</span>
        {VARIABLES.map((v) => (
          <button key={v.key} type="button" onClick={() => insert(v.key)}
            className="rounded-full border border-line-strong bg-surface px-2.5 py-0.5 text-xs text-ink hover:bg-brand-wash">
            {v.label}
          </button>
        ))}
        {maxLength && <span className="ml-auto text-xs text-ink-faint">{value.length}/{maxLength}</span>}
      </div>
    </div>
  );
}
