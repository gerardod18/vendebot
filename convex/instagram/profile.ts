import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { decryptSecret } from "../lib/crypto";
import { createIgClient } from "./client";

export const loadForProfile = internalQuery({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, { contactId }) => {
    const c = await ctx.db.get(contactId);
    const a = c ? await ctx.db.get(c.igAccountId) : null;
    if (!c || !a || a.status !== "active") return null;
    return { igsid: c.igsid, igUserId: a.igUserId, tokenEnc: a.tokenEnc };
  },
});

export const saveProfile = internalMutation({
  args: { contactId: v.id("contacts"), name: v.optional(v.string()), username: v.optional(v.string()), profilePic: v.optional(v.string()) },
  handler: async (ctx, { contactId, ...p }) => {
    const patch = Object.fromEntries(Object.entries(p).filter(([, val]) => val !== undefined));
    if (Object.keys(patch).length) await ctx.db.patch(contactId, patch);
  },
});

/** Best effort: fetch the contact's name/username after their first message. */
export const fetchProfile = internalAction({
  args: { contactId: v.id("contacts") },
  handler: async (ctx, { contactId }) => {
    const t = await ctx.runQuery(internal.instagram.profile.loadForProfile, { contactId });
    const encKey = process.env.TOKEN_ENCRYPTION_KEY;
    if (!t || !encKey) return;
    try {
      const client = createIgClient({
        accessToken: await decryptSecret(t.tokenEnc, encKey), igUserId: t.igUserId, graphVersion: process.env.META_GRAPH_VERSION,
      });
      const p = await client.getContactProfile(t.igsid);
      await ctx.runMutation(internal.instagram.profile.saveProfile, { contactId, ...p });
    } catch {
      /* profile is cosmetic */
    }
  },
});
