/** Data deletion (Meta callback + status page) and account revocation. */
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { rowsFor } from "./lib/accounts";

/** Delete every contact whose Instagram-scoped id (or username-less commenter id) matches, with all derived data. */
export const deleteSubjectData = internalMutation({
  args: { subjectId: v.string(), code: v.string() },
  handler: async (ctx, { subjectId, code }) => {
    const contacts = await ctx.db.query("contacts").withIndex("by_igsid", (q) => q.eq("igsid", subjectId)).collect();
    for (const c of contacts) {
      const convs = await ctx.db.query("conversations").withIndex("by_contact", (q) => q.eq("contactId", c._id)).collect();
      for (const conv of convs) {
        for (const m of await ctx.db.query("messages").withIndex("by_conversation", (q) => q.eq("conversationId", conv._id)).collect()) await ctx.db.delete(m._id);
        for (const n of await ctx.db.query("notes").withIndex("by_conversation", (q) => q.eq("conversationId", conv._id)).collect()) await ctx.db.delete(n._id);
        for (const status of ["waiting", "running", "done", "failed", "cancelled"] as const) {
          for (const r of await ctx.db.query("flowRuns").withIndex("by_conversation_status", (q) => q.eq("conversationId", conv._id).eq("status", status)).collect()) await ctx.db.delete(r._id);
        }
        await ctx.db.delete(conv._id);
      }
      await ctx.db.delete(c._id);
    }
    // Raw webhook payloads can contain the user's text/ids.
    for (const e of await ctx.db.query("webhookEvents").collect()) {
      const raw = e.raw as { senderId?: string } | undefined;
      if (raw?.senderId === subjectId) await ctx.db.delete(e._id);
    }
    await ctx.db.insert("deletionRequests", {
      code, subjectId, requestedAt: Date.now(),
      status: contacts.length ? "completed" : "nothing_found", deletedContacts: contacts.length,
    });
  },
});

export const revokeAccountByIgUserId = internalMutation({
  args: { igUserId: v.string() },
  handler: async (ctx, { igUserId }) => {
    // Meta's callback is about an Instagram user id. Revoke every live Instagram row with that id (normally one).
    for (const a of await rowsFor(ctx, "instagram", igUserId)) {
      if (a.status === "revoked") continue;
      await ctx.db.patch(a._id, { status: "revoked", tokenEnc: "", webhookSubscribed: false });
      for (const t of await ctx.db.query("triggers").withIndex("by_account", (q) => q.eq("igAccountId", a._id)).collect()) {
        await ctx.db.patch(t._id, { enabled: false });
      }
    }
  },
});

/** Public status page lookup (the confirmation code is the secret). */
export const deletionStatus = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const r = await ctx.db.query("deletionRequests").withIndex("by_code", (q) => q.eq("code", code)).unique();
    return r ? { status: r.status, requestedAt: r.requestedAt, deletedContacts: r.deletedContacts } : null;
  },
});
