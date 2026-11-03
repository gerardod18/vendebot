import { useState, type FormEvent } from "react";
import { authClient } from "../lib/auth-client";

export function SignIn() {
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res =
      mode === "signIn"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: name || email });
    if (res.error) setError(res.error.message ?? "Error");
    setBusy(false);
  }

  return (
    <div className="mx-auto mt-24 max-w-sm rounded-xl border bg-white p-6 shadow-sm">
      <h1 className="mb-4 text-xl font-semibold">vendebot</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        {mode === "signUp" && (
          <input className="w-full rounded border px-3 py-2" placeholder="Nombre" value={name}
            onChange={(e) => setName(e.target.value)} />
        )}
        <input className="w-full rounded border px-3 py-2" type="email" placeholder="Email" required
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="w-full rounded border px-3 py-2" type="password" placeholder="Contraseña" required
          minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={busy} className="w-full rounded bg-zinc-900 py-2 text-white disabled:opacity-50">
          {mode === "signIn" ? "Entrar" : "Crear cuenta"}
        </button>
      </form>
      <button className="mt-3 text-sm text-zinc-600 underline"
        onClick={() => setMode(mode === "signIn" ? "signUp" : "signIn")}>
        {mode === "signIn" ? "¿No tienes cuenta? Regístrate" : "¿Ya tienes cuenta? Entra"}
      </button>
    </div>
  );
}
