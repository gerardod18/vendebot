/**
 * Meta "Unified login" helpers (Facebook Login for Business + business system-user token).
 * Pure builders + fetch-injectable calls.
 * ⚠ UNVERIFIED against live Meta: written from Meta's "Instagram API with Unified Login" docs (Nov 2026).
 */
import { FB_GRAPH, parseApiError, type FetchLike } from "./client";

// ---- Unified login (Facebook Login for Business + system-user token) ----
// ⚠ UNVERIFIED against live Meta: written from Meta's "Instagram API with Unified Login" docs (Nov 2026).

/**
 * Public URL of this backend's HTTP actions, used to build the OAuth redirect URI.
 * META_PUBLIC_URL overrides CONVEX_SITE_URL (needed when developing behind a tunnel, since Meta can't reach 127.0.0.1).
 */
export function oauthRedirectUri(): string | null {
  const base = process.env.META_PUBLIC_URL ?? process.env.CONVEX_SITE_URL;
  return base ? `${base.replace(/\/+$/, "")}/meta/oauth/callback` : null;
}

/** Business token never expires unless the configuration says so; refresh is skipped for these. */
export const UNIFIED_TOKEN_TTL_MS = 10 * 365 * 24 * 3600_000;

/** Permissions come from the dashboard configuration (config_id), not from a scope param. */
export function buildUnifiedAuthUrl(p: { appId: string; configId: string; redirectUri: string; state: string }): string {
  const qs = new URLSearchParams({
    client_id: p.appId, config_id: p.configId, redirect_uri: p.redirectUri,
    response_type: "code", state: p.state, display: "popup",
  });
  return `https://www.facebook.com/dialog/oauth?${qs}`;
}

/** code → business-integration system-user token. Uses the Meta app id/secret. */
export async function exchangeUnifiedCode(
  p: { code: string; appId: string; appSecret: string; redirectUri: string; graphVersion?: string },
  fetchFn: FetchLike = (u, i) => fetch(u, i),
): Promise<{ accessToken: string; expiresAt: number }> {
  const qs = new URLSearchParams({ client_id: p.appId, client_secret: p.appSecret, redirect_uri: p.redirectUri, code: p.code });
  const res = await fetchFn(`${FB_GRAPH}/${p.graphVersion ?? "v24.0"}/oauth/access_token?${qs}`, { method: "GET" });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw parseApiError(res.status, json);
  const ttl = typeof json.expires_in === "number" && json.expires_in > 0 ? json.expires_in * 1000 : UNIFIED_TOKEN_TTL_MS;
  return { accessToken: String(json.access_token), expiresAt: Date.now() + ttl };
}

/** Instagram professional accounts the system-user token can act for. */
export async function fetchAssignedInstagramAccounts(
  token: string, graphVersion = "v24.0", fetchFn: FetchLike = (u, i) => fetch(u, i),
): Promise<{ igUserId: string; username: string }[]> {
  const qs = new URLSearchParams({ fields: "id,username" });
  const res = await fetchFn(`${FB_GRAPH}/${graphVersion}/me/assigned_instagram_accounts?${qs}`, {
    method: "GET", headers: { Authorization: `Bearer ${token}` },
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw parseApiError(res.status, json);
  return (Array.isArray(json.data) ? json.data : []).map((r: any) => ({ igUserId: String(r.id), username: String(r.username ?? "") }));
}
