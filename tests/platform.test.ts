import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
const KEY = Buffer.alloc(32, 7).toString("base64");

const who = (t: any, id: string, email = `${id}@x.com`) => t.withIdentity({ subject: id, email });

beforeEach(() => { process.env.SUPERADMIN_EMAILS = "root@x.com"; process.env.TOKEN_ENCRYPTION_KEY = KEY; });
afterEach(() => { delete process.env.SUPERADMIN_EMAILS; delete process.env.TOKEN_ENCRYPTION_KEY; });

async function boot() {
  const t = convexTest(schema, modules);
  const root = who(t, "root");
  await root.mutation(api.platform.claim, {});
  return { t, root };
}

describe("superAdmin role", () => {
  it("only an authorised email can claim, once, and the check does not leak", async () => {
    const t = convexTest(schema, modules);
    expect(await who(t, "eve").query(api.platform.me, {})).toEqual({ isSuperAdmin: false, canClaim: false });
    expect(await t.query(api.platform.me, {})).toEqual({ isSuperAdmin: false, canClaim: false });
    expect(await who(t, "root").query(api.platform.me, {})).toEqual({ isSuperAdmin: false, canClaim: true });
    await expect(who(t, "eve").mutation(api.platform.claim, {})).rejects.toThrow(/Forbidden/);
    await who(t, "root").mutation(api.platform.claim, {});
    expect(await who(t, "root").query(api.platform.me, {})).toEqual({ isSuperAdmin: true, canClaim: false });
    // another account registered with the same email cannot take over the claimed role
    await expect(who(t, "impostor", "root@x.com").mutation(api.platform.claim, {})).rejects.toThrow(/Forbidden/);
  });

  it("platform functions reject everyone who is not a superAdmin", async () => {
    const { t } = await boot();
    const alice = who(t, "alice");
    const orgId = await alice.mutation(api.orgs.create, { name: "Org A" });
    await expect(alice.query(api.platform.overview, {})).rejects.toThrow(/Forbidden/);
    await expect(alice.mutation(api.platform.openOrg, { orgId })).rejects.toThrow(/Forbidden/);
    await expect(alice.query(api.platform.getAiConfig, {})).rejects.toThrow(/Forbidden/);
    await expect(alice.mutation(api.platform.setAiConfig, { provider: "openrouter", model: "openai/gpt-5-mini" })).rejects.toThrow(/Forbidden/);
    await expect(alice.mutation(api.platform.grantAdmin, { email: "a@b.co" })).rejects.toThrow(/Forbidden/);
    await expect(t.query(api.platform.overview, {})).rejects.toThrow();
  });

  it("sees every workspace without exposing tokens, and records the view", async () => {
    const { t, root } = await boot();
    const orgA = await who(t, "alice").mutation(api.orgs.create, { name: "Org A" });
    const orgB = await who(t, "bob").mutation(api.orgs.create, { name: "Org B" });
    await t.run((ctx) => ctx.db.insert("igAccounts", {
      orgId: orgB, igUserId: "ig1", username: "tienda", tokenEnc: "SECRET-TOKEN", tokenExpiresAt: Date.now() + 1e9, status: "active", webhookSubscribed: true, connectedBy: "bob",
    }));
    const { orgs: rows, capped } = await root.query(api.platform.overview, {});
    expect(capped).toBe(false);
    expect(rows.map((r: any) => r.name).sort()).toEqual(["Org A", "Org B"]);
    expect(rows.find((r: any) => r.name === "Org B")).toMatchObject({ members: 1, accounts: 1 });
    expect((await root.query(api.platform.recentAudit, {})).map((a: any) => a.action)).not.toContain("org.view");
    // opening a workspace is the only way to read its detail, and it audits in the same step
    const detail = await root.mutation(api.platform.openOrg, { orgId: orgB });
    expect(detail.accounts[0]).toMatchObject({ username: "tienda", channel: "instagram" });
    expect(JSON.stringify(detail)).not.toContain("SECRET-TOKEN");
    void orgA;
    const audit = await root.query(api.platform.recentAudit, {});
    expect(audit.filter((a: any) => a.action === "org.view")).toMatchObject([{ orgId: orgB, userId: "root" }]);
    expect("orgDetail" in api.platform).toBe(false);
    expect("recordView" in api.platform).toBe(false);
  });

  it("decides the AI provider: validated, keys encrypted and never returned", async () => {
    const { t, root } = await boot();
    expect(await root.query(api.platform.getAiConfig, {})).toMatchObject({ provider: "anthropic", model: "claude-haiku-5-5", hasOpenRouterKey: false });
    await expect(root.mutation(api.platform.setAiConfig, { provider: "openrouter", model: "gpt-5" })).rejects.toThrow(/vendor\/model/);
    await root.mutation(api.platform.setAiConfig, { provider: "openrouter", model: "openai/gpt-5-mini", openRouterKey: "sk-or-secret" });
    const cfg = await root.query(api.platform.getAiConfig, {});
    expect(cfg).toMatchObject({ provider: "openrouter", model: "openai/gpt-5-mini", hasOpenRouterKey: true });
    expect(JSON.stringify(cfg)).not.toContain("sk-or-secret");
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("platformSettings").collect())[0];
      expect(row.openRouterKeyEnc).toBeTruthy();
      expect(row.openRouterKeyEnc).not.toContain("sk-or-secret");
    });
    // omitting a key keeps it; "" removes it
    await root.mutation(api.platform.setAiConfig, { provider: "openrouter", model: "openai/gpt-5-mini" });
    expect((await root.query(api.platform.getAiConfig, {})).hasOpenRouterKey).toBe(true);
    // ...but never to a state where the chosen provider has no key at all (stored or env)
    await expect(root.mutation(api.platform.setAiConfig, { provider: "openrouter", model: "openai/gpt-5-mini", openRouterKey: "" })).rejects.toThrow(/no tiene clave/);
    expect((await root.query(api.platform.getAiConfig, {})).hasOpenRouterKey).toBe(true);
    process.env.OPENROUTER_API_KEY = "env-key";
    try {
      await root.mutation(api.platform.setAiConfig, { provider: "openrouter", model: "openai/gpt-5-mini", openRouterKey: "" });
      expect((await root.query(api.platform.getAiConfig, {})).hasOpenRouterKey).toBe(false);
    } finally { delete process.env.OPENROUTER_API_KEY; }
    // a provider with no key anywhere cannot be selected in the first place
    await expect(root.mutation(api.platform.setAiConfig, { provider: "anthropic", model: "claude-haiku-5-5" })).rejects.toThrow(/no tiene clave/);
  });

  it("grants by email, the grantee claims, and the last active operator cannot be removed", async () => {
    const { t, root } = await boot();
    await root.mutation(api.platform.grantAdmin, { email: "Ops@X.com" });
    await expect(root.mutation(api.platform.grantAdmin, { email: "ops@x.com" })).rejects.toThrow(/ya tiene acceso/);
    const ops = who(t, "ops", "ops@x.com");
    expect(await ops.query(api.platform.me, {})).toMatchObject({ canClaim: true });
    await ops.mutation(api.platform.claim, {});
    const list = await root.query(api.platform.listAdmins, {});
    expect(list.map((a: any) => [a.email, a.active])).toEqual([["root@x.com", true], ["ops@x.com", true]]);
    await root.mutation(api.platform.revokeAdmin, { id: list[1].id });
    await expect(ops.query(api.platform.overview, {})).rejects.toThrow(/Forbidden/);
    await expect(root.mutation(api.platform.revokeAdmin, { id: list[0].id })).rejects.toThrow(/al menos un/);
  });

  it("the env list only bootstraps: a revoked env-listed operator cannot re-claim, a second env email needs a grant", async () => {
    process.env.SUPERADMIN_EMAILS = "root@x.com, second@x.com";
    const { t, root } = await boot();
    // bootstrap is over: another env-listed email gets nothing from the env list any more
    const second = who(t, "second");
    expect(await second.query(api.platform.me, {})).toEqual({ isSuperAdmin: false, canClaim: false });
    await expect(second.mutation(api.platform.claim, {})).rejects.toThrow(/Forbidden/);
    // a pending grant keeps working, even for an email that is also on the env list
    await root.mutation(api.platform.grantAdmin, { email: "second@x.com" });
    expect(await second.query(api.platform.me, {})).toMatchObject({ canClaim: true });
    await second.mutation(api.platform.claim, {});
    // root is revoked by the other operator and cannot come back through the env list
    const list = await second.query(api.platform.listAdmins, {});
    await second.mutation(api.platform.revokeAdmin, { id: list.find((a: any) => a.email === "root@x.com")!.id });
    expect(await root.query(api.platform.me, {})).toEqual({ isSuperAdmin: false, canClaim: false });
    await expect(root.mutation(api.platform.claim, {})).rejects.toThrow(/Forbidden/);
    await expect(root.query(api.platform.overview, {})).rejects.toThrow(/Forbidden/);
    // ...but an operator who was granted again by an active one can
    await second.mutation(api.platform.grantAdmin, { email: "root@x.com" });
    await root.mutation(api.platform.claim, {});
    expect(await root.query(api.platform.me, {})).toMatchObject({ isSuperAdmin: true });
  });

  it("opening a workspace is audited in the same step; a missing workspace records nothing", async () => {
    const { t, root } = await boot();
    const orgId = await who(t, "alice").mutation(api.orgs.create, { name: "Org A" });
    await expect(who(t, "alice").mutation(api.platform.openOrg, { orgId })).rejects.toThrow(/Forbidden/);
    expect(await root.query(api.platform.recentAudit, {})).toHaveLength(1); // only the claim
    const d = await root.mutation(api.platform.openOrg, { orgId });
    expect(d).toMatchObject({ orgId, name: "Org A" });
    expect((await root.query(api.platform.recentAudit, {})).map((a: any) => a.action)).toEqual(["org.view", "superadmin.claim"]);
    await t.run(async (ctx) => {
      const other = await ctx.db.insert("orgs", { name: "gone", slug: "gone", createdBy: "x" });
      await ctx.db.delete(other);
      return other;
    }).then(async (gone) => {
      expect(await root.mutation(api.platform.openOrg, { orgId: gone })).toBeNull();
    });
    expect(await root.query(api.platform.recentAudit, {})).toHaveLength(2);
  });
});
