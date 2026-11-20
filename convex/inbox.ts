import { v } from "convex/values";
import { internal } from "./_generated/api";
import { checkWindow } from "./instagram/window";
import { cancelActiveRuns } from "./engine/runner";
import { orgMutation, orgQuery } from "./lib/tenancy";

export const listConversations = orgQuery({
  args: { mode: v.optional(v.union(v.literal("bot"), v.literal("human"))) },
  handler: async (ctx, { mode }) => {
    const rows = await ctx.db
      .query("conversations").withIndex("by_org_lastMessageAt", (q) => q.eq("orgId", ctx.orgId)).order("desc").take(100);
    const out = [];
    for (const c of rows) {
      if (mode && c.mode !== mode) continue;
      const contact = await ctx.db.get(c.contactId);
      out.push({
        conversationId: c._id, mode: c.mode, unread: c.unread, lastMessageAt: c.lastMessageAt, preview: c.lastMessagePreview,
        assignedTo: c.assignedTo, contactName: contact?.name ?? contact?.username ?? contact?.igsid ?? "?",
      });
    }
    return out;
  },
});

export const getThread = orgQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const conv = await ctx.db.get(conversationId);
    if (!conv || conv.orgId !== ctx.orgId) throw new Error("Conversation not found");
    const contact = await ctx.db.get(conv.contactId);
    const messages = (
      await ctx.db.query("messages").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).order("desc").take(200)
    ).reverse();
    const notes = await ctx.db.query("notes").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).order("desc").take(50);
    const window = checkWindow(contact?.lastInboundAt, Date.now(), { humanAgent: true });
    return {
      conversation: { id: conv._id, mode: conv.mode, assignedTo: conv.assignedTo },
      contact: contact && { name: contact.name, username: contact.username, tags: contact.tags, fields: contact.fields },
      canReply: window !== "closed",
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

/** Human reply. Uses the HUMAN_AGENT tag automatically when the 24h window has passed (up to 7 days). */
export const sendHuman = orgMutation({
  args: { conversationId: v.id("conversations"), text: v.string() },
  handler: async (ctx, { conversationId, text }) => {
    const conv = await ctx.db.get(conversationId);
    if (!conv || conv.orgId !== ctx.orgId) throw new Error("Conversation not found");
    const body = text.trim();
    if (!body || body.length > 1000) throw new Error("Message must be 1-1000 characters");
    const contact = await ctx.db.get(conv.contactId);
    if (checkWindow(contact?.lastInboundAt, Date.now(), { humanAgent: true }) === "closed") {
      throw new Error("The 7-day reply window for this contact has closed");
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
