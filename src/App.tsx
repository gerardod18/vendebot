import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { Route, Routes } from "react-router";
import { SignIn } from "./pages/SignIn";
import { Home } from "./pages/Home";

export function App() {
  return (
    <>
      <AuthLoading>
        <div className="p-8 text-sm text-zinc-500">Cargando…</div>
      </AuthLoading>
      <Unauthenticated>
        <SignIn />
      </Unauthenticated>
      <Authenticated>
        <Routes>
          <Route path="*" element={<Home />} />
        </Routes>
      </Authenticated>
    </>
  );
}
