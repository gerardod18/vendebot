/**
 * Thin Instagram Graph API client ("Instagram API with Instagram Login").
 *
 * ⚠ UNVERIFIED: endpoint paths and field names were written from secondary sources because the
 * authoring sandbox could not reach developers.facebook.com. Confirm against Meta's docs and a real
 * test account before relying on them (see docs/META_SETUP.md). `fetch` is injectable for tests.
 */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type IgClientConfig = {
  accessToken: string;
  igUserId: string;
  graphVersion?: string; // default v24.0, override via META_GRAPH_VERSION
  fetch?: FetchLike;
};

export type QuickReply = { title: string; payload: string };

export type SendTarget = { recipientId: string } | { commentId: string }; // commentId = private reply

export class IgApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly subcode?: number,
    /** true when retrying later may succeed (rate limit / transient). */
    readonly retryable = false,
  ) {
    super(message);
    this.name = "IgApiError";
  }
}

const GRAPH = "https://graph.instagram.com";

export function buildSendBody(
  target: SendTarget,
  content: { text: string; quickReplies?: QuickReply[] },
  opts: { humanAgentTag?: boolean } = {},
) {
  if (content.text.length === 0) throw new Error("text is required");
  if (content.text.length > 1000) throw new Error("text exceeds 1000 characters");
  if (content.quickReplies && content.quickReplies.length > 13) throw new Error("max 13 quick replies");

  const message: Record<string, unknown> = { text: content.text };
  if (content.quickReplies?.length) {
    message.quick_replies = content.quickReplies.map((q) => ({
      content_type: "text",
      title: q.title.slice(0, 20), // IG limits quick reply titles to 20 chars
      payload: q.payload,
    }));
  }
  const body: Record<string, unknown> = {
    recipient: "commentId" in target ? { comment_id: target.commentId } : { id: target.recipientId },
    message,
  };
  if (opts.humanAgentTag) {
    body.messaging_type = "MESSAGE_TAG";
    body.tag = "HUMAN_AGENT";
  }
  return body;
}

export function parseApiError(status: number, json: any): IgApiError {
  const e = json?.error ?? {};
  const code = typeof e.code === "number" ? e.code : undefined;
  // 4/17/32/613 = rate limits; 1/2 = transient; 190 = bad/expired token (NOT retryable).
  const retryable = status === 429 || status >= 500 || [1, 2, 4, 17, 32, 613].includes(code ?? -1);
  return new IgApiError(e.message ?? `Instagram API error (${status})`, status, code, e.error_subcode, retryable);
}

export function createIgClient(cfg: IgClientConfig) {
  const f: FetchLike = cfg.fetch ?? ((url, init) => fetch(url, init));
  const base = `${GRAPH}/${cfg.graphVersion ?? "v24.0"}`;

  async function call(path: string, init: { method: "GET" | "POST"; body?: unknown; query?: Record<string, string> }) {
    const qs = init.query ? `?${new URLSearchParams(init.query)}` : "";
    const res = await f(`${base}${path}${qs}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`, // token in header, never in the URL (keeps it out of logs)
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw parseApiError(res.status, json);
    return json as any;
  }

  return {
    /** Send a DM (or a private reply to a comment). Returns the message id. */
    async sendMessage(
      target: SendTarget,
      content: { text: string; quickReplies?: QuickReply[] },
      opts?: { humanAgentTag?: boolean },
    ): Promise<{ messageId?: string; recipientId?: string }> {
      const json = await call(`/${cfg.igUserId}/messages`, { method: "POST", body: buildSendBody(target, content, opts) });
      return { messageId: json.message_id, recipientId: json.recipient_id };
    },

    /** Basic profile of a contact who messaged us (name/username). */
    async getContactProfile(igsid: string): Promise<{ name?: string; username?: string; profilePic?: string }> {
      const json = await call(`/${igsid}`, { method: "GET", query: { fields: "name,username,profile_pic" } });
      return { name: json.name, username: json.username, profilePic: json.profile_pic };
    },

    /** Subscribe this account to webhook fields (must be done per account after OAuth). */
    async subscribeWebhooks(fields = ["messages", "messaging_postbacks", "comments", "mentions"]) {
      return call(`/${cfg.igUserId}/subscribed_apps`, { method: "POST", query: { subscribed_fields: fields.join(",") } });
    },
  };
}

/** Exchange a short-lived token for a ~60-day one. Needs the app secret, so only call server-side. */
export async function exchangeLongLivedToken(
  shortToken: string,
  appSecret: string,
  fetchFn: FetchLike = (u, i) => fetch(u, i),
): Promise<{ accessToken: string; expiresAt: number }> {
  const qs = new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: appSecret, access_token: shortToken });
  const res = await fetchFn(`${GRAPH}/access_token?${qs}`, { method: "GET" });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw parseApiError(res.status, json);
  return { accessToken: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 5184000) * 1000 };
}

/** Refresh a long-lived token (valid after 24h, before expiry). */
export async function refreshLongLivedToken(
  token: string,
  fetchFn: FetchLike = (u, i) => fetch(u, i),
): Promise<{ accessToken: string; expiresAt: number }> {
  const qs = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token });
  const res = await fetchFn(`${GRAPH}/refresh_access_token?${qs}`, { method: "GET" });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw parseApiError(res.status, json);
  return { accessToken: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 5184000) * 1000 };
}
