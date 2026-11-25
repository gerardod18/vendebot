import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

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
  const { triggerId } = await alice.mutation(api.automations.create, {
    orgId, igAccountId, name: "Precio", template: { key: "keywordReply", text: "Cuesta $10" }, keywords: ["precio"],
  });
  return { t, alice, orgId, triggerId };
}

describe("editing automations", () => {
  it("update rebuilds the graph as a new version and changes the trigger", async () => {
    const { t, alice, orgId, triggerId } = await setup();
    await alice.mutation(api.automations.update, {
      orgId, triggerId, name: "Precios", template: { key: "keywordReply", text: "Cuesta $12" }, keywords: ["precio", "costo"], match: "exact",
    });
    const a = await alice.query(api.automations.get, { orgId, triggerId });
    expect(a).toMatchObject({ name: "Precios", version: 2, config: { keywords: ["precio", "costo"], match: "exact" } });
    expect(JSON.stringify(a!.graph)).toContain("$12");
    await t.run(async (ctx) => {
      expect((await ctx.db.query("flowVersions").collect()).map((v) => v.version).sort()).toEqual([1, 2]);
    });
  });

  it("rejects a template of another type and keyword triggers without keywords", async () => {
    const { alice, orgId, triggerId } = await setup();
    await expect(alice.mutation(api.automations.update, { orgId, triggerId, name: "x", template: { key: "welcome", text: "hola" }, keywords: ["a"] })).rejects.toThrow(/cannot be changed/);
    await expect(alice.mutation(api.automations.update, { orgId, triggerId, name: "x", template: { key: "keywordReply", text: "hola" }, keywords: [] })).rejects.toThrow(/keyword/);
  });

  it("saveGraph validates, stores a new version with layout, and ends form editing", async () => {
    const { alice, orgId, triggerId } = await setup();
    const graph = {
      startNodeId: "a",
      nodes: [{ id: "a", type: "message", text: "Hola" }, { id: "b", type: "message", text: "Chao" }],
      edges: [{ from: "a", port: "next", to: "b" }],
    };
    await expect(alice.mutation(api.automations.saveGraph, { orgId, triggerId, graph: { ...graph, edges: [] } })).rejects.toThrow(/unreachable/);
    await alice.mutation(api.automations.saveGraph, { orgId, triggerId, graph, layout: { a: { x: 0, y: 0 }, b: { x: 300, y: 0 } } });
    const a = await alice.query(api.automations.get, { orgId, triggerId });
    expect(a).toMatchObject({ version: 2, templateConfig: null, layout: { b: { x: 300, y: 0 } } });
    await expect(alice.mutation(api.automations.update, { orgId, triggerId, name: "x", template: { key: "keywordReply", text: "z" }, keywords: ["a"] })).rejects.toThrow(/flow editor/);
    // trigger settings stay editable
    await alice.mutation(api.automations.updateTrigger, { orgId, triggerId, name: "Nuevo", keywords: ["hola"] });
    expect(await alice.query(api.automations.get, { orgId, triggerId })).toMatchObject({ name: "Nuevo", config: { keywords: ["hola"] } });
  });

  it("enforces tenant isolation and admin role", async () => {
    const { t, alice, orgId, triggerId } = await setup();
    const bob = t.withIdentity({ subject: "bob" });
    const orgB = await bob.mutation(api.orgs.create, { name: "Org B" });
    expect(await bob.query(api.automations.get, { orgId: orgB, triggerId })).toBeNull();
    await expect(bob.mutation(api.automations.saveGraph, { orgId: orgB, triggerId, graph: {} })).rejects.toThrow();
    await expect(bob.mutation(api.automations.updateTrigger, { orgId, triggerId, name: "x" })).rejects.toThrow();
    expect(await alice.query(api.automations.get, { orgId, triggerId })).not.toBeNull();
  });
});
