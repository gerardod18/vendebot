import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { encryptSecret } from "../convex/lib/crypto";
import schema from "../convex/schema";
import { buildWhatsAppBody, createWhatsAppClient } from "../convex/whatsapp/client";
import { parseWhatsApp } from "../convex/whatsapp/parse";

const modules = import.meta.glob("../convex/**/*.ts");
const PNID = "109876543210";
const KEY = Buffer.alloc(32, 9).toString("base64");

const payload = (messages: any[], contacts: any[] = [{ profile: { name: "Ana" }, wa_id: "5215512345678" }]) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA1", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp", metadata: { display_phone_number: "15550001111", phone_number_id: PNID }, contacts, messages,
  } }] }],
});
const text = (id: string, body: string) => ({ from: "5215512345678", id, timestamp: "1700000000", type: "text", text: { body } });

describe("parseWhatsApp", () => {
  it("normalizes text messages with sender name and ms timestamp", () => {
    expect(parseWhatsApp(payload([text("wamid.1", "precio")]))).toEqual([
      { type: "message", dedupeKey: "wamid.1", igUserId: PNID, senderId: "5215512345678", timestamp: 1700000000000, senderName: "Ana", text: "precio" },
    ]);
  });
  it("maps button and list replies to quick reply payloads", () => {
    const evs = parseWhatsApp(payload([
      { from: "5215512345678", id: "w2", timestamp: "1", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "P1", title: "Sí" } } },
      { from: "5215512345678", id: "w3", timestamp: "1", type: "interactive", interactive: { type: "list_reply", list_reply: { id: "P2", title: "Dos" } } },
    ]));
    expect(evs.map((e: any) => [e.text, e.quickReplyPayload])).toEqual([["Sí", "P1"], ["Dos", "P2"]]);
  });
  it("keeps media as attachments, ignores status updates and other objects", () => {
    const media: any = parseWhatsApp(payload([{ from: "1", id: "w4", timestamp: "1", type: "image", image: { id: "m" } }]))[0];
    expect(media.type).toBe("message");
    expect(media.text).toBeUndefined();
    const statusOnly = { object: "whatsapp_business_account", entry: [{ id: "W", changes: [{ field: "messages", value: { metadata: { phone_number_id: PNID }, statuses: [{ id: "x" }] } }] }] };
    expect(parseWhatsApp(statusOnly)).toEqual([]);
    expect(parseWhatsApp({ object: "instagram", entry: [] })).toEqual([]);
    expect(parseWhatsApp(null)).toEqual([]);
  });
});

describe("whatsapp client", () => {
  it("builds text, button and list bodies and enforces limits", () => {
    expect(buildWhatsAppBody("521", { text: "hola" })).toMatchObject({ type: "text", to: "521", text: { body: "hola" } });
    const btn: any = buildWhatsAppBody("521", { text: "elige", quickReplies: [{ title: "x".repeat(30), payload: "A" }] });
    expect(btn.interactive.type).toBe("button");
    expect(btn.interactive.action.buttons[0].reply).toEqual({ id: "A", title: "x".repeat(20) });
    const list: any = buildWhatsAppBody("521", { text: "elige", quickReplies: Array.from({ length: 5 }, (_, i) => ({ title: `o${i}`, payload: `p${i}` })) });
    expect(list.interactive.type).toBe("list");
    expect(() => buildWhatsAppBody("521", { text: "x", quickReplies: Array(11).fill({ title: "t", payload: "p" }) })).toThrow();
    expect(() => buildWhatsAppBody("521", { text: "" })).toThrow();
  });
  it("posts to /{phone_number_id}/messages with a bearer token and returns the wamid", async () => {
    const f = vi.fn(async (..._a: unknown[]) => new Response(JSON.stringify({ messages: [{ id: "wamid.OUT" }] }), { status: 200 }));
    const c = createWhatsAppClient({ accessToken: "SECRET", phoneNumberId: PNID, fetch: f as any });
    expect(await c.sendMessage("521", { text: "hi" })).toEqual({ messageId: "wamid.OUT" });
    const [url, init] = f.mock.calls[0] as [string, any];
    expect(url).toBe(`https://graph.facebook.com/v24.0/${PNID}/messages`);
    expect(init.headers.Authorization).toBe("Bearer SECRET");
  });
});

describe("whatsapp end to end", () => {
  let sent: any[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
    sent = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
      if (String(url).endsWith(`/${PNID}/messages`)) {
        sent.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ messages: [{ id: `wamid.out${sent.length}` }] }), { status: 200 });
      }
      if (String(url).includes(`/${PNID}?`)) return new Response(JSON.stringify({ display_phone_number: "+1 555 000 1111", verified_name: "Tienda" }), { status: 200 });
      if (String(url).includes("/subscribed_apps")) return new Response(JSON.stringify({ success: true }), { status: 200 });
      return new Response("{}", { status: 200 });
    }));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  async function settle(t: any) {
    for (let i = 0; i < 6; i++) { vi.advanceTimersByTime(2000); await t.finishInProgressScheduledFunctions(); }
  }

  it("connects a number, receives a WhatsApp message and replies via the Cloud API", async () => {
    const t = convexTest(schema, modules);
    const orgId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("orgs", { name: "Org", slug: "org", createdBy: "u1" });
      await ctx.db.insert("members", { orgId: id, userId: "u1", role: "owner" });
      await ctx.db.insert("members", { orgId: id, userId: "u2", role: "agent" });
      await ctx.db.insert("orgSettings", {
        orgId: id, plan: "free", aiModel: "claude-haiku-5-5", aiMonthlyQuota: 200, timezone: "UTC",
        businessHours: { days: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "23:59" }, defaultLanguage: "es",
      });
      return id;
    });
    const owner = t.withIdentity({ subject: "u1" });
    const creds = { orgId, phoneNumberId: PNID, wabaId: "123456789012", accessToken: "EAAG".padEnd(40, "x") };

    // agents cannot connect channels; owners can
    await expect(t.withIdentity({ subject: "u2" }).mutation(api.accounts.connectWhatsApp, creds)).rejects.toThrow();
    await expect(owner.mutation(api.accounts.connectWhatsApp, { ...creds, phoneNumberId: "abc" })).rejects.toThrow(/numeric/);
    const { accountId } = await owner.mutation(api.accounts.connectWhatsApp, creds);
    await settle(t);
    const acc = await t.run((ctx) => ctx.db.get(accountId));
    expect(acc).toMatchObject({ channel: "whatsapp", username: "+1 555 000 1111", webhookSubscribed: true, status: "active" });
    expect(acc!.tokenEnc).not.toContain("EAAG");

    await owner.mutation(api.automations.create, {
      orgId, igAccountId: accountId, name: "precio", template: { key: "keywordReply", text: "Hola {{first_name}}, cuesta $10" }, keywords: ["precio"],
    });

    const events = parseWhatsApp(payload([{ ...text("wamid.IN1", "¿Precio?"), timestamp: String(Math.floor(Date.now() / 1000)) }]));
    const res = await t.mutation(internal.engine.ingest.ingestEvents, { events });
    for (const a of res.accepted) {
      await t.mutation(internal.engine.runner.processInbound, {
        event: a.event, conversationId: a.conversationId as any, contactId: a.contactId as any, igAccountId: a.igAccountId as any, isFirstContact: a.isFirstContact,
      });
    }
    await settle(t);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ messaging_product: "whatsapp", to: "5215512345678", type: "text", text: { body: "Hola Ana, cuesta $10" } });
    await t.run(async (ctx) => {
      expect((await ctx.db.query("contacts").collect())[0]).toMatchObject({ igsid: "5215512345678", name: "Ana" });
      const out = (await ctx.db.query("messages").collect()).find((m) => m.direction === "out");
      expect(out).toMatchObject({ status: "sent", mid: "wamid.out1" });
    });

    // webhook retry is idempotent
    expect((await t.mutation(internal.engine.ingest.ingestEvents, { events })).duplicates).toBe(1);
  });
});
