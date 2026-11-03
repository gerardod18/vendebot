import { describe, expect, it } from "vitest";
import { parseWebhook } from "../convex/instagram/parse";

const ME = "1784000000";
const USER = "9900112233";

const msg = (message: object, sender = USER, recipient = ME) => ({
  object: "instagram",
  entry: [{ id: ME, time: 1700000000, messaging: [{ sender: { id: sender }, recipient: { id: recipient }, timestamp: 1700000000123, message }] }],
});

describe("parseWebhook", () => {
  it("parses a text DM", () => {
    expect(parseWebhook(msg({ mid: "m1", text: "hola" }))).toEqual([
      { type: "message", dedupeKey: "m1", igUserId: ME, senderId: USER, timestamp: 1700000000123,
        text: "hola", quickReplyPayload: undefined, replyToStoryId: undefined },
    ]);
  });
  it("parses quick reply payload", () => {
    const [e] = parseWebhook(msg({ mid: "m2", text: "Ver precios", quick_reply: { payload: "PRICES" } }));
    expect(e.type === "message" && e.quickReplyPayload).toBe("PRICES");
  });
  it("detects story mentions", () => {
    const [e] = parseWebhook(msg({ mid: "m3", attachments: [{ type: "story_mention", payload: { url: "https://cdn/x" } }] }));
    expect(e).toMatchObject({ type: "story_mention", storyUrl: "https://cdn/x" });
  });
  it("ignores echoes (our own messages) and foreign recipients", () => {
    expect(parseWebhook(msg({ mid: "m4", text: "bot", is_echo: true }, ME, USER))).toEqual([]);
    expect(parseWebhook(msg({ mid: "m5", text: "x" }, USER, "someone-else"))).toEqual([]);
  });
  it("parses postbacks", () => {
    const body = { object: "instagram", entry: [{ id: ME, time: 1, messaging: [
      { sender: { id: USER }, recipient: { id: ME }, timestamp: 5, postback: { mid: "pb1", payload: "BUY", title: "Comprar" } }] }] };
    expect(parseWebhook(body)[0]).toMatchObject({ type: "postback", payload: "BUY", dedupeKey: "pb1" });
  });
  it("parses comments and skips our own and replies flagged", () => {
    const change = (v: object) => ({ object: "instagram", entry: [{ id: ME, time: 1700000000, changes: [{ field: "comments", value: v }] }] });
    const [c] = parseWebhook(change({ id: "c1", text: "precio?", from: { id: USER, username: "ana" }, media: { id: "med1" } }));
    expect(c).toMatchObject({ type: "comment", commentId: "c1", dedupeKey: "comment:c1", mediaId: "med1", isReply: false, username: "ana" });
    const [r] = parseWebhook(change({ id: "c2", text: "x", from: { id: USER }, parent_id: "c1" }));
    expect(r).toMatchObject({ isReply: true });
    expect(parseWebhook(change({ id: "c3", text: "thanks", from: { id: ME } }))).toEqual([]);
  });
  it("never throws on garbage", () => {
    for (const x of [null, undefined, 1, "x", {}, { object: "page" }, { object: "instagram" }, { object: "instagram", entry: [{}] }])
      expect(parseWebhook(x)).toEqual([]);
  });
});
