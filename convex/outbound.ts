/**
 * Outbound Instagram sends. Every send: checks the messaging window, decrypts the account token,
 * calls the Graph client, records the message, retries transient errors, and fails the flow run on hard errors.
 * Rate limiting: Meta's 429/rate-limit errors are retryable and rescheduled with backoff (see DECISIONS D10).
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { recordOutbound } from "./ai/quota";
import { createIgClient, IgApiError } from "./instagram/client";
import { checkWindow } from "./instagram/window";
import { decryptSecret } from "./lib/crypto";
import { isSafeWebhookUrl } from "./lib/safeUrl";

const item = v.object({
  text: v.string(),
  quickReplies: v.optional(v.array(v.object({ title: v.string(), payload: v.string() }))),
});

export const loadTarget = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) return null;
    const contact = await ctx.db.get(conversation.contactId);
    const account = await ctx.db.get(conversation.igAccountId);
    if (!contact || !account) return null;
    return {
      orgId: conversation.orgId,
      igsid: contact.igsid,
      lastInboundAt: contact.lastInboundAt,
      igUserId: account.igUserId,
      tokenEnc: account.tokenEnc,
      accountId: account._id,
      accountStatus: account.status,
    };
  },
});

export const recordMessage = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    text: v.string(),
    source: v.union(v.literal("bot"), v.literal("ai"), v.literal("human")),
    status: v.union(v.literal("sent"), v.literal("failed")),
    mid: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const conv = await ctx.db.get(a.conversationId);
    if (!conv) return;
    const now = Date.now();
    await ctx.db.insert("messages", {
      orgId: conv.orgId, conversationId: conv._id, direction: "out", source: a.source, kind: "text",
      text: a.text, mid: a.mid, sentAt: now, status: a.status, error: a.error,
    });
    await ctx.db.patch(conv._id, { lastMessageAt: now, lastMessagePreview: a.text.slice(0, 80) });
    if (a.status === "sent") await recordOutbound(ctx, conv.orgId, 1, now);
  },
});

export const failRun = internalMutation({
  args: { runId: v.id("flowRuns"), error: v.string() },
  handler: async (ctx, { runId, error }) => {
    const run = await ctx.db.get(runId);
    if (!run || run.status === "cancelled") return; // a "done" run whose last send failed is reported as failed
    await ctx.db.patch(runId, { status: "failed", error, endedAt: Date.now(), waitingFor: undefined });
  },
});

export const markAccountExpired = internalMutation({
  args: { accountId: v.id("igAccounts") },
  handler: async (ctx, { accountId }) => {
    await ctx.db.patch(accountId, { status: "expired" });
  },
});

export const MAX_ATTEMPTS = 3;

export const deliver = internalAction({
  args: {
    conversationId: v.id("conversations"),
    items: v.array(item),
    source: v.union(v.literal("bot"), v.literal("ai"), v.literal("human")),
    replyToCommentId: v.optional(v.string()),
    humanAgent: v.optional(v.boolean()),
    runId: v.optional(v.id("flowRuns")),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const t = await ctx.runQuery(internal.outbound.loadTarget, { conversationId: a.conversationId });
    if (!t || a.items.length === 0) return;
    const fail = async (error: string) => {
      if (a.runId) await ctx.runMutation(internal.outbound.failRun, { runId: a.runId, error });
    };
    if (t.accountStatus !== "active") return fail("account_not_active");

    const decision = checkWindow(t.lastInboundAt, Date.now(), { humanAgent: a.humanAgent, privateReply: Boolean(a.replyToCommentId) });
    if (decision === "closed") {
      await ctx.runMutation(internal.outbound.recordMessage, {
        conversationId: a.conversationId, text: a.items[0].text, source: a.source, status: "failed", error: "window_closed",
      });
      return fail("window_closed");
    }

    const encKey = process.env.TOKEN_ENCRYPTION_KEY;
    if (!encKey) return fail("server_not_configured");
    const client = createIgClient({
      accessToken: await decryptSecret(t.tokenEnc, encKey),
      igUserId: t.igUserId,
      graphVersion: process.env.META_GRAPH_VERSION,
    });

    for (let i = 0; i < a.items.length; i++) {
      const it = a.items[i];
      try {
        const target = i === 0 && a.replyToCommentId ? { commentId: a.replyToCommentId } : { recipientId: t.igsid };
        const r = await client.sendMessage(target, it, { humanAgentTag: decision === "human_agent_tag" });
        await ctx.runMutation(internal.outbound.recordMessage, {
          conversationId: a.conversationId, text: it.text, source: a.source, status: "sent", mid: r.messageId,
        });
      } catch (e) {
        const attempt = a.attempt ?? 0;
        if (e instanceof IgApiError && e.retryable && attempt + 1 < MAX_ATTEMPTS) {
          await ctx.scheduler.runAfter(2 ** attempt * 30_000, internal.outbound.deliver, {
            ...a, items: a.items.slice(i), replyToCommentId: i === 0 ? a.replyToCommentId : undefined, attempt: attempt + 1,
          });
          return;
        }
        const msg = e instanceof Error ? e.message : String(e);
        await ctx.runMutation(internal.outbound.recordMessage, {
          conversationId: a.conversationId, text: it.text, source: a.source, status: "failed", error: msg.slice(0, 300),
        });
        if (e instanceof IgApiError && e.code === 190) {
          await ctx.runMutation(internal.outbound.markAccountExpired, { accountId: t.accountId });
        }
        return fail(`send_failed: ${msg.slice(0, 200)}`);
      }
    }
  },
});

/** Flow "http" action. https + public hosts only, short timeout, response ignored. */
export const httpCall = internalAction({
  args: { url: v.string(), method: v.union(v.literal("GET"), v.literal("POST")), body: v.optional(v.string()) },
  handler: async (_ctx, { url, method, body }) => {
    if (!isSafeWebhookUrl(url)) return;
    try {
      await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: method === "POST" ? body : undefined,
        signal: AbortSignal.timeout(8000),
        redirect: "manual",
      });
    } catch {
      /* best effort */
    }
  },
});

/** Public reply under a comment (comment-to-DM option). UNVERIFIED endpoint, see client.replyToComment. */
export const publicReply = internalAction({
  args: { conversationId: v.id("conversations"), commentId: v.string(), text: v.string() },
  handler: async (ctx, a) => {
    const t = await ctx.runQuery(internal.outbound.loadTarget, { conversationId: a.conversationId });
    const encKey = process.env.TOKEN_ENCRYPTION_KEY;
    if (!t || t.accountStatus !== "active" || !encKey) return;
    const client = createIgClient({
      accessToken: await decryptSecret(t.tokenEnc, encKey), igUserId: t.igUserId, graphVersion: process.env.META_GRAPH_VERSION,
    });
    try {
      await client.replyToComment(a.commentId, a.text);
    } catch {
      /* the DM is the important part; a failed public reply is not fatal */
    }
  },
});
