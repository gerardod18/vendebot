import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { channelOf } from "./lib/accounts";
import { checkWindow } from "./instagram/window";
import { cancelActiveRuns } from "./engine/runner";
import { orgMutation, orgQuery } from "./lib/tenancy";

export const listConversations = orgQuery({
  args: { mode: v.optional(v.union(v.literal("bot"), v.literal("human"))) },
  handler: async (ctx, { mode }) => {
    // The org (and mode) filter is part of the index range, so the limit applies to THIS workspace's rows only.
    const rows = mode
      ? await ctx.db.query("conversations").withIndex("by_org_mode_lastMessageAt", (q) => q.eq("orgId", ctx.orgId).eq("mode", mode)).order("desc").take(100)
      : await ctx.db.query("conversations").withIndex("by_org_lastMessageAt", (q) => q.eq("orgId", ctx.orgId)).order("desc").take(100);
    const out = [];
    for (const c of rows) {
      const contact = await ctx.db.get(c.contactId);
      out.push({
        conversationId: c._id, mode: c.mode, unread: c.unread, lastMessageAt: c.lastMessageAt, preview: c.lastMessagePreview,
        assignedTo: c.assignedTo, contactName: contact?.name ?? contact?.username ?? contact?.igsid ?? "?",
      });
    }
    return out;
  },
});

/**
 * Who may a person still write to, and how. Same rule as outbound.deliver: WhatsApp has a 24h window and no
 * HUMAN_AGENT extension; Instagram has 24h, extended to 7 days with the HUMAN_AGENT tag.
 */
async function replyState(ctx: QueryCtx & { orgId: Id<"orgs"> }, conv: Doc<"conversations">) {
  const [contact, account] = await Promise.all([ctx.db.get(conv.contactId), ctx.db.get(conv.igAccountId)]);
  if (!account || account.orgId !== ctx.orgId || (contact && contact.orgId !== ctx.orgId)) return null;
  const channel = channelOf(account);
  const window = checkWindow(contact?.lastInboundAt, Date.now(), { humanAgent: channel !== "whatsapp" });
  return { contact, account, channel, window, canReply: account.status === "active" && window !== "closed" };
}

/** The thread, or null when the conversation does not exist in this workspace (e.g. a stale selection after switching workspace). */
export const getThread = orgQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const conv = await ctx.db.get(conversationId);
    if (!conv || conv.orgId !== ctx.orgId) return null;
    const state = await replyState(ctx, conv);
    if (!state) return null;
    const { contact } = state;
    const messages = (
      await ctx.db.query("messages").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).order("desc").take(200)
    ).reverse();
    const notes = await ctx.db.query("notes").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).order("desc").take(50);
    return {
      conversation: { id: conv._id, mode: conv.mode, assignedTo: conv.assignedTo },
      channel: state.channel,
      contact: contact && { name: contact.name, username: contact.username, tags: contact.tags, fields: contact.fields },
      canReply: state.canReply,
      messages: messages.map((m) => ({ id: m._id, direction: m.direction, source: m.source, text: m.text, kind: m.kind, status: m.status, error: m.error, at: m.sentAt })),
      notes: notes.map((n) => ({ id: n._id, text: n.text, author: n.author, at: n.createdAt })),
    };
  },
});

export const markRead = orgMutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const conv = await ctx.db.get(conversationId);
    if (!conv || conv.orgId !== ctx.orgId) throw new Error("Conversation not found");
    if (conv.unread) await ctx.db.patch(conversationId, { unread: 0 });
  },
});

/** A person takes the conversation: the bot stops and any running flow is cancelled. */
export const takeOver = orgMutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const conv = await ctx.db.get(conversationId);
    if (!conv || conv.orgId !== ctx.orgId) throw new Error("Conversation not found");
    await cancelActiveRuns(ctx, conversationId);
    await ctx.db.patch(conversationId, { mode: "human", assignedTo: ctx.userId });
  },
});

export const giveBack = orgMutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const conv = await ctx.db.get(conversationId);
    if (!conv || conv.orgId !== ctx.orgId) throw new Error("Conversation not found");
    await ctx.db.patch(conversationId, { mode: "bot", assignedTo: undefined });
  },
});

/** Human reply. Instagram: HUMAN_AGENT tag automatically after 24h (up to 7 days). WhatsApp: 24h only. */
export const sendHuman = orgMutation({
  args: { conversationId: v.id("conversations"), text: v.string() },
  handler: async (ctx, { conversationId, text }) => {
    const conv = await ctx.db.get(conversationId);
    if (!conv || conv.orgId !== ctx.orgId) throw new Error("Conversation not found");
    const body = text.trim();
    if (!body || body.length > 1000) throw new Error("Message must be 1-1000 characters");
    const state = await replyState(ctx, conv);
    if (!state) throw new Error("Conversation not found"); // the account or contact belongs to another workspace
    if (state.account.status !== "active") throw new Error("This account is disconnected");
    if (state.window === "closed") {
      throw new Error(state.channel === "whatsapp"
        ? "The 24-hour reply window for this WhatsApp contact has closed"
        : "The 7-day reply window for this contact has closed");
    }
    if (conv.mode !== "human") {
      await cancelActiveRuns(ctx, conversationId);
      await ctx.db.patch(conversationId, { mode: "human", assignedTo: ctx.userId });
    }
    await ctx.scheduler.runAfter(0, internal.outbound.deliver, {
      conversationId, items: [{ text: body }], source: "human", humanAgent: true,
    });
  },
});
