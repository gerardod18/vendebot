import { afterEach, describe, expect, it, vi } from "vitest";
import { createIgClient } from "../convex/instagram/client";
import {
  buildUnifiedAuthUrl, exchangeUnifiedCode, fetchAssignedInstagramAccounts, UNIFIED_TOKEN_TTL_MS,
} from "../convex/instagram/oauth";

const ok = (json: unknown, status = 200) => new Response(JSON.stringify(json), { status });
afterEach(() => vi.unstubAllEnvs());

describe("unified login", () => {
  it("builds the Facebook Login for Business URL with config_id and no scope", () => {
    const u = new URL(buildUnifiedAuthUrl({ appId: "1", configId: "cfg", redirectUri: "https://x/cb", state: "s" }));
    expect(u.origin + u.pathname).toBe("https://www.facebook.com/dialog/oauth");
    expect(u.searchParams.get("config_id")).toBe("cfg");
    expect(u.searchParams.get("client_id")).toBe("1");
    expect(u.searchParams.get("scope")).toBeNull();
  });

  it("exchanges the code on graph.facebook.com and defaults to a long expiry", async () => {
    const f = vi.fn(async (..._a: unknown[]) => ok({ access_token: "TOK" }));
    const r = await exchangeUnifiedCode({ code: "c", appId: "1", appSecret: "sec", redirectUri: "https://x/cb" }, f);
    expect(String(f.mock.calls[0][0])).toContain("https://graph.facebook.com/v24.0/oauth/access_token");
    expect(r.accessToken).toBe("TOK");
    expect(r.expiresAt).toBeGreaterThan(Date.now() + UNIFIED_TOKEN_TTL_MS - 5000);
  });

  it("lists assigned instagram accounts", async () => {
    const f = vi.fn(async (..._a: unknown[]) => ok({ data: [{ id: "17841", username: "almeidagdev" }] }));
    expect(await fetchAssignedInstagramAccounts("T", "v24.0", f)).toEqual([{ igUserId: "17841", username: "almeidagdev" }]);
    expect(String(f.mock.calls[0][0])).toContain("/me/assigned_instagram_accounts");
  });

  it("client targets graph.facebook.com in unified mode and graph.instagram.com otherwise", async () => {
    const f = vi.fn(async (..._a: unknown[]) => ok({ message_id: "m" }));
    vi.stubEnv("META_LOGIN_MODE", "unified");
    await createIgClient({ accessToken: "t", igUserId: "17841", fetch: f }).sendMessage({ recipientId: "u" }, { text: "hi" });
    expect(String(f.mock.calls[0][0])).toMatch(/^https:\/\/graph\.facebook\.com\/v24\.0\/17841\/messages/);
    vi.stubEnv("META_LOGIN_MODE", "");
    await createIgClient({ accessToken: "t", igUserId: "17841", fetch: f }).sendMessage({ recipientId: "u" }, { text: "hi" });
    expect(String(f.mock.calls[1][0])).toMatch(/^https:\/\/graph\.instagram\.com\//);
  });
});
