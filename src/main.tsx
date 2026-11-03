import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexBetterAuthProvider, type AuthClient } from "@convex-dev/better-auth/react";
import { BrowserRouter } from "react-router";
import { authClient } from "./lib/auth-client";
import { App } from "./App";
import "./index.css";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string, {
  // Pause queries until the auth token is loaded.
  expectAuth: true,
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexBetterAuthProvider client={convex} // Cast: the plugin-array type inferred by better-auth 1.6.34 does not narrow to the provider's AuthClient union.
      authClient={authClient as unknown as AuthClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConvexBetterAuthProvider>
  </StrictMode>,
);
