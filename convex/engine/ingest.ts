import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { InboundEvent } from "../instagram/parse";

/**
 * Stores normalized inbound events. Idempotent: an event whose dedupeKey was already stored is skipped,
 * so Meta's webhook retries never create duplicate messages or runs.
 * Returns what the (future) processor needs to route each NEW event.
 */
export const ingestEvents = internalMutation({
  args: { events: v.array(v.any()) },
  handler: async (ctx, args) => {
    const events = args.events as InboundEvent[];
    const accepted: {
      event: InboundEvent;
      orgId: string;
      igAccountId: string;
      contactId: string;
      conversationId: string;
      isFirstContact: boolean;
    }[] = [];
    let duplicates = 0;
    let unknownAccount = 0;

    for (const event of events) {
      const account = await ctx.db
        .query("igAccounts")
        .withIndex("by_igUserId", (q) => q.eq("igUserId", event.igUserId))
        .unique();
      if (!account || account.status === "revoked") {
        unknownAccount++;
        continue;
      }

      const seen = await ctx.db
        .query("webhookEvents")
        .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", event.dedupeKey))
        .first();
      if (seen) {
        duplicates++;
        continue;
      }

      const now = Date.now();
      await ctx.db.insert("webhookEvents", {
        dedupeKey: event.dedupeKey,
        orgId: account.orgId,
        igAccountId: account._id,
        type: event.type,
        raw: event,
        receivedAt: now,
      });

      // Contact upsert
      let contact = await ctx.db
        .query("contacts")
        .withIndex("by_account_igsid", (q) => q.eq("igAccountId", account._id).eq("igsid", event.senderId))
        .unique();
      const isFirstContact = !contact;
      const isDm = event.type !== "comment";
      if (!contact) {
        const id = await ctx.db.insert("contacts", {
          orgId: account.orgId,
          igAccountId: account._id,
          igsid: event.senderId,
          username: event.type === "comment" ? event.username : undefined,
          tags: [],
          fields: {},
          lastInboundAt: isDm ? event.timestamp : undefined,
          firstSeenAt: now,
        });
        contact = (await ctx.db.get(id))!;
      } else if (isDm) {
        // The 24h messaging window is driven by DMs only.
        await ctx.db.patch(contact._id, { lastInboundAt: Math.max(contact.lastInboundAt ?? 0, event.timestamp) });
      }

      // Conversation upsert
      let conversation = await ctx.db
        .query("conversations")
        .withIndex("by_contact", (q) => q.eq("contactId", contact!._id))
        .first();
      const preview =
        event.type === "message" ? event.text ?? "[adjunto]"
        : event.type === "comment" ? `💬 ${event.text}`
        : event.type === "story_mention" ? "📸 Mención en historia"
        : `↩ ${event.title ?? event.payload}`;
      if (!conversation) {
        const id = await ctx.db.insert("conversations", {
          orgId: account.orgId,
          igAccountId: account._id,
          contactId: contact._id,
          mode: "bot",
          lastMessageAt: now,
          lastMessagePreview: preview,
          unread: 1,
        });
        conversation = (await ctx.db.get(id))!;
      } else {
        await ctx.db.patch(conversation._id, {
          lastMessageAt: now,
          lastMessagePreview: preview,
          unread: conversation.unread + 1,
        });
      }

      await ctx.db.insert("messages", {
        orgId: account.orgId,
        conversationId: conversation._id,
        direction: "in",
        source: "contact",
        kind:
          event.type === "message" ? (event.quickReplyPayload ? "quick_reply" : "text")
          : event.type === "comment" ? "comment"
          : event.type === "story_mention" ? "story_mention"
          : "postback",
        text: event.type === "message" || event.type === "comment" ? event.text : undefined,
        payload: event,
        mid: event.dedupeKey,
        sentAt: event.timestamp,
        status: "received",
      });

      accepted.push({
        event,
        orgId: account.orgId,
        igAccountId: account._id,
        contactId: contact._id,
        conversationId: conversation._id,
        isFirstContact,
      });
    }

    return { accepted, duplicates, unknownAccount };
  },
});
