import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";

const siteUrl = process.env.SITE_URL ?? "http://localhost:5173";

/** Better Auth component client. Use `authComponent.safeGetAuthUser(ctx)` to read the current user. */
export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(ctx),
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    // crossDomain: the SPA (Vite) runs on a different origin than the Convex site URL.
    plugins: [crossDomain({ siteUrl }), convex({ authConfig })],
  });

/** Current signed-in user (or null). */
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => (await authComponent.safeGetAuthUser(ctx)) ?? null,
});
