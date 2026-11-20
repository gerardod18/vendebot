/**
 * Instagram Login (OAuth) helpers. Pure builders + fetch-injectable exchange calls.
 * ⚠ UNVERIFIED against live Meta: authorize URL, token endpoint and `me` fields come from secondary sources.
 */
import { parseApiError, type FetchLike } from "./client";

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
