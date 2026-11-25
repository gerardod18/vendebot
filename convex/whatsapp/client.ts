/**
 * Thin WhatsApp Cloud API client (graph.facebook.com). `fetch` is injectable for tests.
 * ⚠ UNVERIFIED against live Meta: written from Meta's WhatsApp Cloud API docs.
 * Free-form messages are only allowed inside the 24h customer-service window (enforced upstream by checkWindow);
 * outside it, WhatsApp requires approved templates, which are not implemented yet.
 */
import { FB_GRAPH, parseApiError, type FetchLike, type QuickReply } from "../instagram/client";

export type WhatsAppClientConfig = { accessToken: string; phoneNumberId: string; graphVersion?: string; fetch?: FetchLike };

/** text → plain text; 1–3 quick replies → reply buttons; 4–10 → list message. */
export function buildWhatsAppBody(to: string, content: { text: string; quickReplies?: QuickReply[] }) {
  const { text, quickReplies } = content;
  if (!text) throw new Error("text is required");
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  if (!quickReplies?.length) {
    if (text.length > 4096) throw new Error("text exceeds 4096 characters");
    return { ...base, type: "text", text: { body: text, preview_url: false } };
  }
  if (text.length > 1024) throw new Error("interactive body exceeds 1024 characters");
  if (quickReplies.length > 10) throw new Error("max 10 quick replies on WhatsApp");
  if (quickReplies.length <= 3) {
    return {
      ...base, type: "interactive",
      interactive: {
        type: "button", body: { text },
        action: { buttons: quickReplies.map((q) => ({ type: "reply", reply: { id: q.payload.slice(0, 256), title: q.title.slice(0, 20) } })) },
      },
    };
  }
  return {
    ...base, type: "interactive",
    interactive: {
      type: "list", body: { text },
      action: { button: "Opciones", sections: [{ title: "Opciones", rows: quickReplies.map((q) => ({ id: q.payload.slice(0, 200), title: q.title.slice(0, 24) })) }] },
    },
  };
}

export function createWhatsAppClient(cfg: WhatsAppClientConfig) {
  const f: FetchLike = cfg.fetch ?? ((url, init) => fetch(url, init));
  const base = `${FB_GRAPH}/${cfg.graphVersion ?? "v24.0"}`;

  async function call(path: string, method: "GET" | "POST", opts: { body?: unknown; query?: Record<string, string> } = {}) {
    const qs = opts.query ? `?${new URLSearchParams(opts.query)}` : "";
    const res = await f(`${base}${path}${qs}`, {
      method,
      headers: { Authorization: `Bearer ${cfg.accessToken}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw parseApiError(res.status, json);
    return json as any;
  }

  return {
    async sendMessage(to: string, content: { text: string; quickReplies?: QuickReply[] }): Promise<{ messageId?: string }> {
      const json = await call(`/${cfg.phoneNumberId}/messages`, "POST", { body: buildWhatsAppBody(to, content) });
      return { messageId: json.messages?.[0]?.id };
    },
    /** Verifies the token + phone number id and returns the human-readable number. */
    async getPhoneNumber(): Promise<{ displayPhoneNumber: string; verifiedName?: string }> {
      const json = await call(`/${cfg.phoneNumberId}`, "GET", { query: { fields: "display_phone_number,verified_name" } });
      return { displayPhoneNumber: String(json.display_phone_number ?? cfg.phoneNumberId), verifiedName: json.verified_name };
    },
    /** Subscribes the app to this WhatsApp Business Account's webhooks. */
    async subscribeWaba(wabaId: string) {
      return call(`/${wabaId}/subscribed_apps`, "POST");
    },
  };
}
