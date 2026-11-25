import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { LIBRARY, checkLibrary } from "../convex/engine/library";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

describe("sales flow library", () => {
  it("every flow is a valid graph with sane copy", () => {
    expect(checkLibrary()).toEqual([]);
    expect(LIBRARY.map((f) => f.level)).toEqual(["Básica", "Intermedia", "Avanzada", "Avanzada", "Experta"]);
    for (const f of LIBRARY) {
      for (const n of f.graph.nodes) {
        if (n.type === "message" || n.type === "quickReplies") expect(n.text.length, `${f.id}/${n.id}`).toBeLessThanOrEqual(1000);
        if (n.type === "quickReplies") for (const o of n.options) expect(o.title.length, `${f.id}/${o.title}`).toBeLessThanOrEqual(20);
        if (n.type === "wait") expect(n.minutes).toBeLessThan(24 * 60); // follow-ups must stay inside the 24h window
      }
    }
  });

  it("an unmatched reply to the product menu is not recorded as a fact: it goes to a person", () => {
    const f = LIBRARY.find((x) => x.id === "pedido-paso-a-paso")!;
    const next = f.graph.edges.find((e) => e.from === "q_prod" && e.port === "next")!;
    const target = f.graph.nodes.find((n) => n.id === next.to)!;
    expect(target.type).toBe("handoff");
    // no setField action is reachable from that edge before the handoff
    expect(f.graph.edges.filter((e) => e.from === next.to)).toEqual([]);
    // the real choices still record their own interest
    const grano = f.graph.nodes.find((n) => n.id === f.graph.edges.find((e) => e.from === "q_prod" && e.port === "grano")!.to)!;
    expect(JSON.stringify(grano)).toContain("café en grano");
  });

  it("comment flows open with a single message (a private reply allows one)", () => {
    const f = LIBRARY.find((x) => x.trigger.type === "comment")!;
    const start = f.graph.nodes.find((n) => n.id === f.graph.startNodeId)!;
    expect(start.type).toBe("quickReplies");
    expect(f.channels).toEqual(["instagram"]);
  });

  it("creates every flow for an admin, rejects other tenants and unsupported channels", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "alice" });
    const orgId = await alice.mutation(api.orgs.create, { name: "Org A" });
    const mk = (igUserId: string, channel?: "whatsapp") => t.run((ctx) => ctx.db.insert("igAccounts", {
      orgId, igUserId, username: "x", tokenEnc: "x", tokenExpiresAt: Date.now() + 1e9, status: "active", webhookSubscribed: true, connectedBy: "alice", ...(channel ? { channel } : {}),
    }));
    const ig = await mk("ig1"), wa = await mk("wa1", "whatsapp");
    for (const f of LIBRARY) await alice.mutation(api.automations.createFromLibrary, { orgId, libraryId: f.id, igAccountId: ig });
    const list = await alice.query(api.automations.list, { orgId });
    expect(list.map((a) => a.type).sort()).toEqual(["comment", "default", "keyword", "keyword", "welcome"]);
    await expect(alice.mutation(api.automations.createFromLibrary, { orgId, libraryId: "comentario-a-venta", igAccountId: wa })).rejects.toThrow(/not available/);
    await alice.mutation(api.automations.createFromLibrary, { orgId, libraryId: "pedido-paso-a-paso", igAccountId: wa });
    await expect(alice.mutation(api.automations.createFromLibrary, { orgId, libraryId: "nope", igAccountId: ig })).rejects.toThrow(/Unknown/);
    const bob = t.withIdentity({ subject: "bob" });
    const orgB = await bob.mutation(api.orgs.create, { name: "Org B" });
    await expect(bob.mutation(api.automations.createFromLibrary, { orgId: orgB, libraryId: "precio-rapido", igAccountId: ig })).rejects.toThrow();
  });
});
