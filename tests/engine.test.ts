import { describe, expect, it } from "vitest";
import { validateGraph, type Graph } from "../convex/engine/graph";
import { initialState, interpolate, step, type RunContext } from "../convex/engine/interpreter";
import { buildGraph } from "../convex/engine/templates";

const ctx = (over: Partial<RunContext> = {}): RunContext => ({
  contact: { name: "Ana García", username: "ana", tags: [], fields: {} },
  inBusinessHours: true,
  aiQuotaAvailable: true,
  ...over,
});

describe("validateGraph", () => {
  const ok: Graph = { startNodeId: "a", nodes: [{ id: "a", type: "message", text: "hi" }], edges: [] };
  it("accepts a minimal graph", () => expect(validateGraph(ok).ok).toBe(true));
  it("reports structural problems", () => {
    const bad = {
      startNodeId: "zzz",
      nodes: [
        { id: "a", type: "message", text: "hi" },
        { id: "f", type: "filter", mode: "all", conditions: [{ kind: "businessHours" }] },
        { id: "orphan", type: "message", text: "x" },
      ],
      edges: [{ from: "a", port: "next", to: "nope" }, { from: "a", port: "weird", to: "f" }],
    };
    const r = validateGraph(bad);
    expect(r.ok).toBe(false);
    const msg = !r.ok ? r.errors.join("|") : "";
    expect(msg).toMatch(/startNodeId/);
    expect(msg).toMatch(/unknown node "nope"/);
    expect(msg).toMatch(/no port "weird"/);
    expect(msg).toMatch(/filter "f" needs both/);
  });
  it("rejects schema violations and never throws on garbage", () => {
    expect(validateGraph({ startNodeId: "a", nodes: [], edges: [] }).ok).toBe(false);
    expect(validateGraph(null).ok).toBe(false);
    expect(validateGraph({ startNodeId: "a", nodes: [{ id: "a", type: "message", text: "x".repeat(1001) }], edges: [] }).ok).toBe(false);
  });
});

describe("interpolate", () => {
  it("fills first_name, username, fields and vars; missing vars vanish", () => {
    const c = ctx({ contact: { name: "Ana García", username: "ana", tags: [], fields: { ciudad: "Lima" } } });
    expect(interpolate("Hola {{first_name}} de {{ciudad}}!", c, {})).toBe("Hola Ana de Lima!");
    expect(interpolate("Hola {{first_name}} {{missing}}", c, {})).toBe("Hola Ana");
    expect(interpolate("Hola {{missing}}, bienvenido", c, {})).toBe("Hola, bienvenido");
    expect(interpolate("{{x}}", c, { x: "v" })).toBe("v");
  });
});

describe("step()", () => {
  it("runs message → handoff to completion", () => {
    const g = buildGraph({ key: "keywordReply", text: "Hola {{first_name}}", handoffAfter: true });
    const { state, effects } = step(g, initialState(g), ctx());
    expect(state.status).toBe("done");
    expect(effects).toEqual([{ type: "send", text: "Hola Ana" }, { type: "handoff", message: undefined }]);
  });

  it("quick replies wait, then branch on payload", () => {
    const g: Graph = {
      startNodeId: "q",
      nodes: [
        { id: "q", type: "quickReplies", text: "¿Qué quieres?", options: [{ title: "Precios", payload: "P" }, { title: "Humano", payload: "H" }] },
        { id: "p", type: "message", text: "Precios..." },
        { id: "h", type: "handoff" },
      ],
      edges: [{ from: "q", port: "P", to: "p" }, { from: "q", port: "H", to: "h" }],
    };
    expect(validateGraph(g).ok).toBe(true);
    const a = step(g, initialState(g), ctx());
    expect(a.state).toMatchObject({ status: "waiting", waitingFor: "reply", nodeId: "q" });
    const b = step(g, a.state, ctx(), { kind: "reply", payload: "H" });
    expect(b.state.status).toBe("done");
    expect(b.effects).toEqual([{ type: "handoff", message: undefined }]);
    // a timer input is not applicable to a reply wait: stays put
    expect(step(g, a.state, ctx(), { kind: "timer" }).state.status).toBe("waiting");
  });

  it("waitForReply saves the answer and supports timeout", () => {
    const g: Graph = {
      startNodeId: "w",
      nodes: [
        { id: "w", type: "waitForReply", timeoutMinutes: 30, saveAs: "email" },
        { id: "ok", type: "message", text: "Gracias, anoté {{email}}" },
        { id: "late", type: "message", text: "¿Sigues ahí?" },
      ],
      edges: [{ from: "w", port: "next", to: "ok" }, { from: "w", port: "timeout", to: "late" }],
    };
    const a = step(g, initialState(g), ctx());
    expect(a.effects).toEqual([{ type: "scheduleTimeout", minutes: 30, reason: "reply" }]);
    expect(step(g, a.state, ctx(), { kind: "reply", text: "a@b.co" }).effects).toEqual([{ type: "send", text: "Gracias, anoté a@b.co" }]);
    expect(step(g, a.state, ctx(), { kind: "timeout" }).effects).toEqual([{ type: "send", text: "¿Sigues ahí?" }]);
  });

  it("detects loops instead of hanging", () => {
    const g: Graph = {
      startNodeId: "a",
      nodes: [{ id: "a", type: "message", text: "x" }, { id: "b", type: "message", text: "y" }],
      edges: [{ from: "a", port: "next", to: "b" }, { from: "b", port: "next", to: "a" }],
    };
    const r = step(g, initialState(g), ctx());
    expect(r.state.status).toBe("failed");
    expect(r.state.error).toMatch(/exceeded/);
  });

  it("action node emits effects and sets vars", () => {
    const g: Graph = {
      startNodeId: "a",
      nodes: [
        { id: "a", type: "action", actions: [{ kind: "addTag", tag: "lead" }, { kind: "setField", key: "src", value: "ig" }, { kind: "note", text: "{{first_name}} pidió info" }] },
      ],
      edges: [],
    };
    const r = step(g, initialState(g), ctx());
    expect(r.effects).toEqual([
      { type: "addTag", tag: "lead" }, { type: "setField", key: "src", value: "ig" }, { type: "note", text: "Ana pidió info" },
    ]);
    expect(r.state.status).toBe("done");
  });
});

describe("defaultReply template (SendPulse-style)", () => {
  const g = buildGraph({
    key: "defaultReply",
    fallbackText: "Gracias por escribirnos, te respondemos en unos minutos.",
    ai: { instructions: "Eres el asistente de la tienda.", timeoutMinutes: 60 },
  });

  it("goes to the AI agent in business hours with quota", () => {
    const r = step(g, initialState(g), ctx());
    expect(r.state).toMatchObject({ status: "waiting", waitingFor: "ai", nodeId: "ai1" });
    expect(r.effects[0]).toMatchObject({ type: "startAi", instructions: "Eres el asistente de la tienda." });
  });
  it("sends the fallback outside business hours", () => {
    const r = step(g, initialState(g), ctx({ inBusinessHours: false }));
    expect(r.effects).toEqual([{ type: "send", text: "Gracias por escribirnos, te respondemos en unos minutos." }]);
    expect(r.state.status).toBe("done");
  });
  it("falls back when the AI quota is exhausted, even mid-conversation", () => {
    expect(step(g, initialState(g), ctx({ aiQuotaAvailable: false })).effects[0]).toMatchObject({ type: "send" });
    const waiting = step(g, initialState(g), ctx()).state;
    const r = step(g, waiting, ctx(), { kind: "aiQuotaExceeded" });
    expect(r.effects).toEqual([{ type: "send", text: "Gracias por escribirnos, te respondemos en unos minutos." }]);
  });
  it("AI exit hands off to a human", () => {
    const waiting = step(g, initialState(g), ctx()).state;
    const r = step(g, waiting, ctx(), { kind: "aiExit" });
    expect(r.effects).toEqual([{ type: "handoff", message: undefined }]);
  });
  it("without AI, default reply is a single message", () => {
    const g2 = buildGraph({ key: "defaultReply", fallbackText: "Hola" });
    expect(step(g2, initialState(g2), ctx()).effects).toEqual([{ type: "send", text: "Hola" }]);
  });
});

describe("other templates build valid graphs", () => {
  it.each(["welcome", "storyMention", "commentToDm", "keywordReply"] as const)("%s", (key) => {
    const g = buildGraph({ key, text: "Hola", quickReplies: [{ title: "Sí", payload: "YES" }], handoffAfter: true });
    expect(validateGraph(g).ok).toBe(true);
  });
});
