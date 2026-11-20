import { describe, expect, it } from "vitest";
import { buildSystemPrompt, toModelMessages, MAX_KNOWLEDGE_CHARS } from "../convex/ai/prompt";
import { estimateCostMicros } from "../convex/ai/pricing";
import { quotaForPlan, currentMonth } from "../convex/lib/plans";
import { isWithinBusinessHours } from "../convex/lib/time";
import { checkWindow, HOUR } from "../convex/instagram/window";

describe("buildSystemPrompt", () => {
  it("includes rules, org + node instructions, knowledge, exit condition", () => {
    const p = buildSystemPrompt({
      orgInstructions: "We sell shoes.", nodeInstructions: "Qualify the lead.", exitWhen: "customer gives phone",
      knowledge: [{ title: "Envíos", content: "Gratis sobre $50" }], contactName: "Ana", language: "es",
    });
    expect(p).toContain("Spanish");
    expect(p).toContain("We sell shoes.");
    expect(p).toContain("Qualify the lead.");
    expect(p).toContain("### Envíos");
    expect(p).toContain("exit_flow when: customer gives phone");
    expect(p).toContain("Ana");
    expect(p.indexOf("Fixed rules")).toBeLessThan(p.indexOf("We sell shoes."));
  });
  it("caps knowledge size", () => {
    const big = { title: "x", content: "a".repeat(MAX_KNOWLEDGE_CHARS) };
    const p = buildSystemPrompt({ nodeInstructions: "", knowledge: [big, { title: "second", content: "b" }], language: "en" });
    expect(p).not.toContain("### second");
  });
});

describe("toModelMessages", () => {
  it("merges same-role runs, starts with user, limits history", () => {
    const m = toModelMessages([
      { direction: "out", text: "hola" }, { direction: "in", text: "a" }, { direction: "in", text: "b" },
      { direction: "out", text: "c" }, { direction: "in", text: "d" },
    ]);
    expect(m).toEqual([
      { role: "user", content: "a\nb" }, { role: "assistant", content: "c" }, { role: "user", content: "d" },
    ]);
    expect(toModelMessages([{ direction: "in", text: "1" }, { direction: "out", text: "2" }, { direction: "in", text: "3" }], 1)).toEqual([
      { role: "user", content: "3" },
    ]);
  });
});

describe("pricing / plans / time / window", () => {
  it("estimates cost for known models only", () => {
    expect(estimateCostMicros("claude-haiku-5-5", 3000, 250)).toEqual({ micros: 425, known: true });
    expect(estimateCostMicros("anthropic/claude-sonnet-5-5", 1_000_000, 0).micros).toBe(2_000_000);
    expect(estimateCostMicros("openai/gpt-5-mini", 10, 10)).toEqual({ micros: 0, known: false });
  });
  it("maps plans to quotas, defaulting to free", () => {
    expect(quotaForPlan("pro")).toBe(10000);
    expect(quotaForPlan("weird")).toBe(200);
    expect(currentMonth(Date.UTC(2026, 10, 20))).toBe("2026-11");
  });
  it("business hours honour timezone and weekday", () => {
    const hours = { days: [1, 2, 3, 4, 5], start: "08:00", end: "17:00" };
    // Mon 2026-11-23 15:00 UTC = 10:00 in Bogota (UTC-5)
    expect(isWithinBusinessHours(hours, "America/Bogota", Date.UTC(2026, 10, 23, 15, 0))).toBe(true);
    expect(isWithinBusinessHours(hours, "America/Bogota", Date.UTC(2026, 10, 23, 12, 0))).toBe(false); // 07:00
    expect(isWithinBusinessHours(hours, "UTC", Date.UTC(2026, 10, 22, 12, 0))).toBe(false); // Sunday
    expect(isWithinBusinessHours(hours, "Not/AZone", Date.UTC(2026, 10, 23, 12, 0))).toBe(false);
  });
  it("messaging window", () => {
    const now = 1_000_000_000_000;
    expect(checkWindow(now - 23 * HOUR, now)).toBe("ok");
    expect(checkWindow(now - 30 * HOUR, now)).toBe("closed");
    expect(checkWindow(now - 30 * HOUR, now, { humanAgent: true })).toBe("human_agent_tag");
    expect(checkWindow(now - 8 * 24 * HOUR, now, { humanAgent: true })).toBe("closed");
    expect(checkWindow(undefined, now)).toBe("closed");
    expect(checkWindow(undefined, now, { privateReply: true })).toBe("ok");
  });
});
