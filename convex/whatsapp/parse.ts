/**
 * Normalizes WhatsApp Cloud API webhook payloads into the same InboundEvent shape the Instagram
 * parser produces, so ingest, routing, the runner and the inbox are channel-agnostic.
 *
 * Mapping: `igUserId` = our phone_number_id, `senderId` = the contact's wa_id (phone number),
 * `dedupeKey` = the wamid message id. Button/list replies become messages carrying `quickReplyPayload`
 * (same as Instagram quick replies). Status updates (sent/delivered/read) are ignored.
 * ⚠ UNVERIFIED against live traffic: written from Meta's WhatsApp Cloud API docs.
 */
import type { InboundEvent } from "../instagram/parse";

type Json = Record<string, any>;
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

export function parseWhatsApp(body: unknown): InboundEvent[] {
  const events: InboundEvent[] = [];
  const root = body as Json | null;
  if (!root || root.object !== "whatsapp_business_account" || !Array.isArray(root.entry)) return events;

  for (const entry of root.entry as Json[]) {
    for (const change of Array.isArray(entry?.changes) ? (entry.changes as Json[]) : []) {
      const value = change?.value as Json | undefined;
      if (change?.field !== "messages" || !value) continue;
      const phoneNumberId = str(value.metadata?.phone_number_id);
      if (!phoneNumberId || !Array.isArray(value.messages)) continue;
      const names = new Map<string, string>();
      for (const c of Array.isArray(value.contacts) ? (value.contacts as Json[]) : []) {
        const id = str(c?.wa_id), name = str(c?.profile?.name);
        if (id && name) names.set(id, name);
      }

      for (const m of value.messages as Json[]) {
        const id = str(m?.id), from = str(m?.from);
        if (!id || !from) continue;
        const timestamp = (Number(m.timestamp) || Math.floor(Date.now() / 1000)) * 1000;
        const base = { type: "message" as const, dedupeKey: id, igUserId: phoneNumberId, senderId: from, timestamp, senderName: names.get(from) };

        if (m.type === "text") {
          events.push({ ...base, text: str(m.text?.body) });
        } else if (m.type === "interactive") {
          const reply = m.interactive?.button_reply ?? m.interactive?.list_reply;
          events.push({ ...base, text: str(reply?.title), quickReplyPayload: str(reply?.id) });
        } else if (m.type === "button") {
          events.push({ ...base, text: str(m.button?.text), quickReplyPayload: str(m.button?.payload) });
        } else {
          events.push({ ...base }); // image, audio, location, etc.: stored as an attachment
        }
      }
    }
  }
  return events;
}
