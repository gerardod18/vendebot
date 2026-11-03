import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { authClient } from "../lib/auth-client";

export function Home() {
  const user = useQuery(api.auth.getCurrentUser);
  return (
    <div className="p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">vendebot</h1>
        <button className="text-sm underline" onClick={() => authClient.signOut()}>Salir</button>
      </div>
      <p className="mt-4 text-sm text-zinc-600">Hola {user?.name ?? user?.email}</p>
    </div>
  );
}
