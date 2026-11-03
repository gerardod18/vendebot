import { describe, expect, it, vi } from "vitest";
import { buildSendBody, createIgClient, IgApiError, parseApiError, type FetchLike } from "../convex/instagram/client";

const ok = (json: unknown, status = 200) => new Response(JSON.stringify(json), { status });

describe("buildSendBody", () => {
  it("builds a DM body with quick replies, truncating titles to 20 chars", () => {
    const b: any = buildSendBody({ recipientId: "u1" }, { text: "Hola", quickReplies: [{ title: "x".repeat(30), payload: "P" }] });
    expect(b.recipient).toEqual({ id: "u1" });
    expect(b.message.quick_replies[0]).toEqual({ content_type: "text", title: "x".repeat(20), payload: "P" });
  });
  it("uses comment_id for private replies and adds HUMAN_AGENT tag when asked", () => {
    const b: any = buildSendBody({ commentId: "c1" }, { text: "Hi" }, { humanAgentTag: true });
    expect(b.recipient).toEqual({ comment_id: "c1" });
    expect(b).toMatchObject({ messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" });
  });
  it("enforces limits", () => {
    expect(() => buildSendBody({ recipientId: "u" }, { text: "" })).toThrow();
    expect(() => buildSendBody({ recipientId: "u" }, { text: "x".repeat(1001) })).toThrow();
    expect(() => buildSendBody({ recipientId: "u" }, { text: "a", quickReplies: Array(14).fill({ title: "t", payload: "p" }) })).toThrow();
  });
});

describe("createIgClient", () => {
  it("sends with the token in the Authorization header, not the URL", async () => {
    const f = vi.fn<FetchLike>(async () => ok({ message_id: "mid1", recipient_id: "u1" }));
    const c = createIgClient({ accessToken: "SECRET", igUserId: "me", fetch: f });
    const r = await c.sendMessage({ recipientId: "u1" }, { text: "hola" });
    expect(r).toEqual({ messageId: "mid1", recipientId: "u1" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://graph.instagram.com/v24.0/me/messages");
    expect(url).not.toContain("SECRET");
    expect((init.headers as any).Authorization).toBe("Bearer SECRET");
  });
  it("maps API errors, marking rate limits retryable and bad tokens not", async () => {
    const mk = (status: number, code: number) =>
      createIgClient({ accessToken: "t", igUserId: "me", fetch: async () => ok({ error: { message: "boom", code } }, status) });
    await expect(mk(400, 190).sendMessage({ recipientId: "u" }, { text: "x" })).rejects.toMatchObject({ retryable: false, code: 190 });
    await expect(mk(400, 4).sendMessage({ recipientId: "u" }, { text: "x" })).rejects.toMatchObject({ retryable: true });
    await expect(mk(503, 0).sendMessage({ recipientId: "u" }, { text: "x" })).rejects.toBeInstanceOf(IgApiError);
  });
  it("parseApiError tolerates empty bodies", () => {
    expect(parseApiError(500, undefined).retryable).toBe(true);
  });
});
