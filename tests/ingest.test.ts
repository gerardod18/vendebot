import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { parseWebhook } from "../convex/instagram/parse";

const modules = import.meta.glob("../convex/**/*.ts");
const ME = "1784000000";

async function seed() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("orgs", { name: "Org", slug: "org", createdBy: "u1" });
    const igAccountId = await ctx.db.insert("igAccounts", {
      orgId, igUserId: ME, username: "tienda", tokenEnc: "x", tokenExpiresAt: Date.now() + 1e9,
      status: "active", webhookSubscribed: true, connectedBy: "u1",
    });
    return { orgId, igAccountId };
  });
  return { t, ...ids };
}

const dm = (mid: string, text: string, sender = "user1", ts = 1700000000000) =>
  parseWebhook({ object: "instagram", entry: [{ id: ME, time: 1, messaging: [
    { sender: { id: sender }, recipient: { id: ME }, timestamp: ts, message: { mid, text } }] }] });

describe("ingestEvents", () => {
  it("creates contact, conversation and message for a first DM", async () => {
    const { t } = await seed();
    const res = await t.mutation(internal.engine.ingest.ingestEvents, { events: dm("m1", "hola") });
    expect(res.accepted).toHaveLength(1);
    expect(res.accepted[0].isFirstContact).toBe(true);
    await t.run(async (ctx) => {
      const conv = await ctx.db.query("conversations").collect();
      expect(conv).toHaveLength(1);
      expect(conv[0]).toMatchObject({ mode: "bot", unread: 1, lastMessagePreview: "hola" });
      const msgs = await ctx.db.query("messages").collect();
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toMatchObject({ direction: "in", source: "contact", kind: "text", text: "hola", mid: "m1" });
      const c = await ctx.db.query("contacts").collect();
      expect(c[0].lastInboundAt).toBe(1700000000000);
    });
  });

  it("is idempotent: redelivering the same mid creates nothing new", async () => {
    const { t } = await seed();
    await t.mutation(internal.engine.ingest.ingestEvents, { events: dm("m1", "hola") });
    const again = await t.mutation(internal.engine.ingest.ingestEvents, { events: dm("m1", "hola") });
    expect(again.accepted).toHaveLength(0);
    expect(again.duplicates).toBe(1);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("messages").collect()).toHaveLength(1);
      expect((await ctx.db.query("conversations").collect())[0].unread).toBe(1);
    });
  });

  it("second message from same contact reuses conversation and is not a first contact", async () => {
    const { t } = await seed();
    await t.mutation(internal.engine.ingest.ingestEvents, { events: dm("m1", "hola") });
    const res = await t.mutation(internal.engine.ingest.ingestEvents, { events: dm("m2", "precio?", "user1", 1700000005000) });
    expect(res.accepted[0].isFirstContact).toBe(false);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("conversations").collect()).toHaveLength(1);
      expect((await ctx.db.query("conversations").collect())[0].unread).toBe(2);
      expect((await ctx.db.query("contacts").collect())[0].lastInboundAt).toBe(1700000005000);
    });
  });

  it("ignores events for unknown or revoked accounts", async () => {
    const { t, igAccountId } = await seed();
    const foreign = parseWebhook({ object: "instagram", entry: [{ id: "999", time: 1, messaging: [
      { sender: { id: "u" }, recipient: { id: "999" }, timestamp: 1, message: { mid: "x", text: "hi" } }] }] });
    expect((await t.mutation(internal.engine.ingest.ingestEvents, { events: foreign })).unknownAccount).toBe(1);
    await t.run((ctx) => ctx.db.patch(igAccountId, { status: "revoked" }));
    const res = await t.mutation(internal.engine.ingest.ingestEvents, { events: dm("m9", "hola") });
    expect(res.accepted).toHaveLength(0);
  });

  it("comments do not extend the DM window", async () => {
    const { t } = await seed();
    const comment = parseWebhook({ object: "instagram", entry: [{ id: ME, time: 1700000000, changes: [
      { field: "comments", value: { id: "c1", text: "quiero", from: { id: "user2", username: "bob" }, media: { id: "med" } } }] }] });
    await t.mutation(internal.engine.ingest.ingestEvents, { events: comment });
    await t.run(async (ctx) => {
      const c = (await ctx.db.query("contacts").collect())[0];
      expect(c).toMatchObject({ igsid: "user2", username: "bob" });
      expect(c.lastInboundAt).toBeUndefined();
      expect((await ctx.db.query("messages").collect())[0]).toMatchObject({ kind: "comment", text: "quiero" });
    });
  });
});
