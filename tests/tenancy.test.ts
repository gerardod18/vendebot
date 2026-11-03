import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import schema from "../convex/schema";

// convex-test needs explicit module globs. Components are not loaded (not needed for these tests).
const modules = import.meta.glob("../convex/**/*.ts");

const setup = () => convexTest(schema, modules);
const as = (t: ReturnType<typeof setup>, userId: string) => t.withIdentity({ subject: userId });

describe("orgs + tenancy", () => {
  it("create makes the caller owner and seeds default settings", async () => {
    const t = setup();
    const orgId = await as(t, "u1").mutation(api.orgs.create, { name: "Tienda Ana" });
    const mine = await as(t, "u1").query(api.orgs.listMine, {});
    expect(mine).toEqual([{ orgId, name: "Tienda Ana", slug: "tienda-ana", role: "owner" }]);
    const settings = await as(t, "u1").query(api.orgs.getSettings, { orgId });
    expect(settings).toMatchObject({ aiModel: "claude-haiku-5-5", aiMonthlyQuota: 200, hasByoKey: false });
    expect(settings).not.toHaveProperty("byoAnthropicKeyEnc");
  });

  it("slugs stay unique for duplicate names", async () => {
    const t = setup();
    await as(t, "u1").mutation(api.orgs.create, { name: "Same Name" });
    await as(t, "u2").mutation(api.orgs.create, { name: "Same Name" });
    const a = await as(t, "u1").query(api.orgs.listMine, {});
    const b = await as(t, "u2").query(api.orgs.listMine, {});
    expect(a[0].slug).toBe("same-name");
    expect(b[0].slug).not.toBe("same-name");
  });

  it("denies access to another tenant's org (queries and mutations)", async () => {
    const t = setup();
    const orgA = await as(t, "alice").mutation(api.orgs.create, { name: "Org A" });
    await expect(as(t, "mallory").query(api.orgs.listMembers, { orgId: orgA })).rejects.toThrow(/Forbidden/);
    await expect(as(t, "mallory").query(api.orgs.getSettings, { orgId: orgA })).rejects.toThrow(/Forbidden/);
    await expect(
      as(t, "mallory").mutation(api.orgs.setMemberRole, { orgId: orgA, memberUserId: "alice", role: "agent" }),
    ).rejects.toThrow(/Forbidden/);
    expect(await as(t, "mallory").query(api.orgs.listMine, {})).toEqual([]);
  });

  it("requires authentication", async () => {
    const t = setup();
    const orgA = await as(t, "alice").mutation(api.orgs.create, { name: "Org A" });
    await expect(t.query(api.orgs.listMembers, { orgId: orgA })).rejects.toThrow(/Not authenticated/);
    await expect(t.mutation(api.orgs.create, { name: "X Corp" })).rejects.toThrow(/Not authenticated/);
    expect(await t.query(api.orgs.listMine, {})).toEqual([]);
  });

  it("enforces roles: agents cannot change roles; owner role is immutable", async () => {
    const t = setup();
    const orgId = await as(t, "owner1").mutation(api.orgs.create, { name: "Role Org" });
    await t.run(async (ctx) => {
      await ctx.db.insert("members", { orgId, userId: "agent1", role: "agent" });
      await ctx.db.insert("members", { orgId, userId: "admin1", role: "admin" });
    });
    await expect(
      as(t, "agent1").mutation(api.orgs.setMemberRole, { orgId, memberUserId: "agent1", role: "admin" }),
    ).rejects.toThrow(/insufficient role/);
    await as(t, "admin1").mutation(api.orgs.setMemberRole, { orgId, memberUserId: "agent1", role: "admin" });
    await expect(
      as(t, "admin1").mutation(api.orgs.setMemberRole, { orgId, memberUserId: "owner1", role: "agent" }),
    ).rejects.toThrow(/Owner role/);
    // agents can still read members
    expect((await as(t, "agent1").query(api.orgs.listMembers, { orgId })).length).toBe(3);
  });

  it("rejects invalid workspace names", async () => {
    const t = setup();
    await expect(as(t, "u1").mutation(api.orgs.create, { name: " a " })).rejects.toThrow(/2-60/);
  });
});
