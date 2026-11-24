/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as admin from "../admin.js";
import type * as ai_agent from "../ai/agent.js";
import type * as ai_models from "../ai/models.js";
import type * as ai_pricing from "../ai/pricing.js";
import type * as ai_prompt from "../ai/prompt.js";
import type * as ai_provider from "../ai/provider.js";
import type * as ai_quota from "../ai/quota.js";
import type * as auth from "../auth.js";
import type * as automations from "../automations.js";
import type * as billing from "../billing.js";
import type * as crons from "../crons.js";
import type * as engine_graph from "../engine/graph.js";
import type * as engine_ingest from "../engine/ingest.js";
import type * as engine_interpreter from "../engine/interpreter.js";
import type * as engine_router from "../engine/router.js";
import type * as engine_runner from "../engine/runner.js";
import type * as engine_templates from "../engine/templates.js";
import type * as http from "../http.js";
import type * as inbox from "../inbox.js";
import type * as instagram_client from "../instagram/client.js";
import type * as instagram_oauth from "../instagram/oauth.js";
import type * as instagram_parse from "../instagram/parse.js";
import type * as instagram_profile from "../instagram/profile.js";
import type * as instagram_signature from "../instagram/signature.js";
import type * as instagram_signedRequest from "../instagram/signedRequest.js";
import type * as instagram_window from "../instagram/window.js";
import type * as knowledge from "../knowledge.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_plans from "../lib/plans.js";
import type * as lib_safeUrl from "../lib/safeUrl.js";
import type * as lib_tenancy from "../lib/tenancy.js";
import type * as lib_time from "../lib/time.js";
import type * as meta from "../meta.js";
import type * as orgs from "../orgs.js";
import type * as outbound from "../outbound.js";
import type * as privacy from "../privacy.js";
import type * as usage from "../usage.js";
import type * as whatsapp_client from "../whatsapp/client.js";
import type * as whatsapp_parse from "../whatsapp/parse.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  admin: typeof admin;
  "ai/agent": typeof ai_agent;
  "ai/models": typeof ai_models;
  "ai/pricing": typeof ai_pricing;
  "ai/prompt": typeof ai_prompt;
  "ai/provider": typeof ai_provider;
  "ai/quota": typeof ai_quota;
  auth: typeof auth;
  automations: typeof automations;
  billing: typeof billing;
  crons: typeof crons;
  "engine/graph": typeof engine_graph;
  "engine/ingest": typeof engine_ingest;
  "engine/interpreter": typeof engine_interpreter;
  "engine/router": typeof engine_router;
  "engine/runner": typeof engine_runner;
  "engine/templates": typeof engine_templates;
  http: typeof http;
  inbox: typeof inbox;
  "instagram/client": typeof instagram_client;
  "instagram/oauth": typeof instagram_oauth;
  "instagram/parse": typeof instagram_parse;
  "instagram/profile": typeof instagram_profile;
  "instagram/signature": typeof instagram_signature;
  "instagram/signedRequest": typeof instagram_signedRequest;
  "instagram/window": typeof instagram_window;
  knowledge: typeof knowledge;
  "lib/crypto": typeof lib_crypto;
  "lib/plans": typeof lib_plans;
  "lib/safeUrl": typeof lib_safeUrl;
  "lib/tenancy": typeof lib_tenancy;
  "lib/time": typeof lib_time;
  meta: typeof meta;
  orgs: typeof orgs;
  outbound: typeof outbound;
  privacy: typeof privacy;
  usage: typeof usage;
  "whatsapp/client": typeof whatsapp_client;
  "whatsapp/parse": typeof whatsapp_parse;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  workflow: import("@convex-dev/workflow/_generated/component.js").ComponentApi<"workflow">;
  eventPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"eventPool">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
