import { v } from "convex/values";
import { orgAdminMutation, orgQuery } from "./lib/tenancy";

const MAX_ENTRIES = 50;

export const list = orgQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("knowledge").withIndex("by_org", (q) => q.eq("orgId", ctx.orgId)).collect();
    return rows.map((k) => ({ id: k._id, title: k.title, content: k.content }));
  },
});

export const save = orgAdminMutation({
  args: { id: v.optional(v.id("knowledge")), title: v.string(), content: v.string() },
  handler: async (ctx, { id, title, content }) => {
    const t = title.trim(), c = content.trim();
    if (!t || t.length > 100) throw new Error("Title must be 1-100 characters");
    if (!c || c.length > 4000) throw new Error("Content must be 1-4000 characters");
    if (id) {
      const k = await ctx.db.get(id);
      if (!k || k.orgId !== ctx.orgId) throw new Error("Entry not found");
      await ctx.db.patch(id, { title: t, content: c });
      return id;
    }
    const count = (await ctx.db.query("knowledge").withIndex("by_org", (q) => q.eq("orgId", ctx.orgId)).collect()).length;
    if (count >= MAX_ENTRIES) throw new Error(`Up to ${MAX_ENTRIES} entries`);
    return ctx.db.insert("knowledge", { orgId: ctx.orgId, title: t, content: c });
  },
});

export const remove = orgAdminMutation({
  args: { id: v.id("knowledge") },
  handler: async (ctx, { id }) => {
    const k = await ctx.db.get(id);
    if (!k || k.orgId !== ctx.orgId) throw new Error("Entry not found");
    await ctx.db.delete(id);
  },
});
