/**
 * Normalizes Instagram webhook payloads into InboundEvent[].
 * Payload shapes follow Meta's Instagram Platform docs (messaging + `changes` for comments).
 * Unknown shapes are ignored, never thrown. Verify against live payloads when possible.
 */

export type InboundEvent =
  | {
      type: "message";
      dedupeKey: string; // message mid
      igUserId: string; // our account (recipient)
      senderId: string; // the contact (IGSID)
      timestamp: number;
      text?: string;
      quickReplyPayload?: string;
      replyToStoryId?: string;
    }
  | {
      type: "story_mention";
      dedupeKey: string;
      igUserId: string;
      senderId: string;
      timestamp: number;
      storyUrl?: string;
    }
  | {
      type: "postback";
      dedupeKey: string;
      igUserId: string;
      senderId: string;
      timestamp: number;
      payload: string;
      title?: string;
    }
  | {
      type: "comment";
      dedupeKey: string; // comment id
      igUserId: string;
      senderId: string; // commenter
      username?: string;
      timestamp: number;
      commentId: string;
      mediaId?: string;
      text: string;
      isReply: boolean; // a reply to another comment
    };

type Json = Record<string, any>;

const asString = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : v != null && typeof v === "number" ? String(v) : undefined;

export function parseWebhook(body: unknown): InboundEvent[] {
  const events: InboundEvent[] = [];
  const root = body as Json | null;
  if (!root || root.object !== "instagram" || !Array.isArray(root.entry)) return events;

  for (const entry of root.entry as Json[]) {
    const igUserId = asString(entry?.id);
    if (!igUserId) continue;

    for (const m of (Array.isArray(entry.messaging) ? entry.messaging : []) as Json[]) {
      const senderId = asString(m?.sender?.id);
      const recipientId = asString(m?.recipient?.id);
      if (!senderId || senderId === igUserId || recipientId !== igUserId) continue; // skip echoes / foreign
      const timestamp = Number(m.timestamp) || Date.now();

      if (m.message && !m.message.is_echo) {
        const mid = asString(m.message.mid);
        if (!mid) continue;
        const attachments = Array.isArray(m.message.attachments) ? (m.message.attachments as Json[]) : [];
        const story = attachments.find((a) => a?.type === "story_mention");
        if (story) {
          events.push({
            type: "story_mention", dedupeKey: mid, igUserId, senderId, timestamp,
            storyUrl: asString(story.payload?.url),
          });
          continue;
        }
        events.push({
          type: "message", dedupeKey: mid, igUserId, senderId, timestamp,
          text: asString(m.message.text),
          quickReplyPayload: asString(m.message.quick_reply?.payload),
          replyToStoryId: asString(m.message.reply_to?.story?.id),
        });
      } else if (m.postback) {
        const payload = asString(m.postback.payload);
        if (!payload) continue;
        events.push({
          type: "postback",
          dedupeKey: asString(m.postback.mid) ?? `pb:${senderId}:${timestamp}:${payload}`,
          igUserId, senderId, timestamp, payload, title: asString(m.postback.title),
        });
      }
    }

    for (const c of (Array.isArray(entry.changes) ? entry.changes : []) as Json[]) {
      if (c?.field !== "comments" || !c.value) continue;
      const v = c.value as Json;
      const commentId = asString(v.id);
      const senderId = asString(v.from?.id);
      const text = typeof v.text === "string" ? v.text : "";
      if (!commentId || !senderId || senderId === igUserId) continue; // ignore our own comments
      events.push({
        type: "comment", dedupeKey: `comment:${commentId}`, igUserId, senderId,
        username: asString(v.from?.username),
        timestamp: Number(entry.time) ? Number(entry.time) * 1000 : Date.now(),
        commentId, mediaId: asString(v.media?.id), text, isReply: Boolean(asString(v.parent_id)),
      });
    }
  }
  return events;
}
