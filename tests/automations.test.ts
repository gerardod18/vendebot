import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";
import { validateGraph } from "../convex/engine/graph";

const modules = import.meta.glob("../convex/**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const alice = t.withIdentity({ subject: "alice" });
  const orgId = await alice.mutation(api.orgs.create, { name: "Org A" });
  const igAccountId = await t.run((ctx) =>
    ctx.db.insert("igAccounts", {
      orgId, igUserId: "ig1", username: "tienda", tokenEnc: "x", tokenExpiresAt: Date.now() + 1e9,
      status: "active", webhookSubscribed: true, connectedBy: "alice",
    }),
  );
  return { t, alice, orgId, igAccountId };
}

describe("automations", () => {
  it("creates a default-reply automation with AI: flow, valid graph, trigger", async () => {
    const { t, alice, orgId, igAccountId } = await setup();
    await alice.mutation(api.automations.create, {
      orgId, igAccountId, name: "Respuesta estándar",
      template: { key: "defaultReply", fallbackText: "Te respondemos pronto", ai: { instructions: "Sé amable." } },
    });
    const list = await alice.query(api.automations.list, { orgId });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Respuesta estándar", type: "default", enabled: true, firedCount: 0 });
    await t.run(async (ctx) => {
      const v = (await ctx.db.query("flowVersions").collect())[0];
      expect(validateGraph(v.graph).ok).toBe(true);
      const f = (await ctx.db.query("flows").collect())[0];
      expect(f.activeVersionId).toBe(v._id);
    });
  });

  it("keyword automations require keywords and store them", async () => {
    const { alice, orgId, igAccountId } = await setup();
    const template = { key: "keywordReply", text: "Nuestros precios..." };
    await expect(alice.mutation(api.automations.create, { orgId, igAccountId, name: "Precios", template })).rejects.toThrow(/keyword/);
    await alice.mutation(api.automations.create, { orgId, igAccountId, name: "Precios", template, keywords: [" precio ", "costo", ""] });
    const [a] = await alice.query(api.automations.list, { orgId });
    expect(a.config).toEqual({ keywords: ["precio", "costo"], match: "contains" });
  });

  it("rejects invalid templates and another org's Instagram account", async () => {
    const { t, alice, orgId, igAccountId } = await setup();
    await expect(
      alice.mutation(api.automations.create, { orgId, igAccountId, name: "x", template: { key: "welcome", text: "" } }),
    ).rejects.toThrow(/Invalid template/);
    const bob = t.withIdentity({ subject: "bob" });
    const orgB = await bob.mutation(api.orgs.create, { name: "Org B" });
    await expect(
      bob.mutation(api.automations.create, { orgId: orgB, igAccountId, name: "steal", template: { key: "welcome", text: "hi" } }),
    ).rejects.toThrow(/Instagram account not found/);
  });

  it("is tenant-isolated and role-gated; toggle and remove work", async () => {
    const { t, alice, orgId, igAccountId } = await setup();
    const { triggerId } = await alice.mutation(api.automations.create, {
      orgId, igAccountId, name: "Hola", template: { key: "welcome", text: "Hola!" },
    });
    const mallory = t.withIdentity({ subject: "mallory" });
    await expect(mallory.query(api.automations.list, { orgId })).rejects.toThrow(/Forbidden/);
    await expect(mallory.mutation(api.automations.setEnabled, { orgId, triggerId, enabled: false })).rejects.toThrow(/Forbidden/);

    await t.run((ctx) => ctx.db.insert("members", { orgId, userId: "agent1", role: "agent" }));
    const agent = t.withIdentity({ subject: "agent1" });
    await expect(agent.mutation(api.automations.setEnabled, { orgId, triggerId, enabled: false })).rejects.toThrow(/insufficient role/);
    expect(await agent.query(api.automations.list, { orgId })).toHaveLength(1); // agents may read

    await alice.mutation(api.automations.setEnabled, { orgId, triggerId, enabled: false });
    expect((await alice.query(api.automations.list, { orgId }))[0].enabled).toBe(false);
    await alice.mutation(api.automations.remove, { orgId, triggerId });
    expect(await alice.query(api.automations.list, { orgId })).toHaveLength(0);
  });
});
