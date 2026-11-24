/**
 * Instagram Login (OAuth) helpers. Pure builders + fetch-injectable exchange calls.
 * ⚠ UNVERIFIED against live Meta: authorize URL, token endpoint and `me` fields come from secondary sources.
 */
import { FB_GRAPH, parseApiError, type FetchLike } from "./client";

export const IG_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
];

export function buildAuthUrl(p: { appId: string; redirectUri: string; state: string; scopes?: string[] }): string {
  const qs = new URLSearchParams({
    client_id: p.appId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: (p.scopes ?? IG_SCOPES).join(","),
    state: p.state,
  });
  return `https://www.instagram.com/oauth/authorize?${qs}`;
}

/** Authorization code → short-lived token + the Instagram user id. */
export async function exchangeCode(
  p: { code: string; appId: string; appSecret: string; redirectUri: string },
  fetchFn: FetchLike = (u, i) => fetch(u, i),
): Promise<{ accessToken: string; igUserId: string }> {
  const body = new URLSearchParams({
    client_id: p.appId, client_secret: p.appSecret, grant_type: "authorization_code",
    redirect_uri: p.redirectUri, code: p.code,
  });
  const res = await fetchFn("https://api.instagram.com/oauth/access_token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw parseApiError(res.status, json);
  // Some responses wrap the payload in `data: [ ... ]`.
  const row = Array.isArray(json.data) ? json.data[0] : json;
  return { accessToken: String(row.access_token ?? json.access_token), igUserId: String(row.user_id ?? json.user_id) };
}

export async function fetchOwnProfile(
  token: string, graphVersion = "v24.0", fetchFn: FetchLike = (u, i) => fetch(u, i),
): Promise<{ igUserId: string; username: string; name?: string; profilePictureUrl?: string }> {
  const qs = new URLSearchParams({ fields: "user_id,username,name,profile_picture_url" });
  const res = await fetchFn(`https://graph.instagram.com/${graphVersion}/me?${qs}`, {
    method: "GET", headers: { Authorization: `Bearer ${token}` },
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw parseApiError(res.status, json);
  return {
    igUserId: String(json.user_id ?? json.id), username: String(json.username ?? ""),
    name: json.name, profilePictureUrl: json.profile_picture_url,
  };
}

// ---- Unified login (Facebook Login for Business + system-user token) ----
// ⚠ UNVERIFIED against live Meta: written from Meta's "Instagram API with Unified Login" docs (Nov 2026).

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
