import { describe, expect, it } from "vitest";
import { keywordMatches, normalizeText, routeEvent, type TriggerDef } from "../convex/engine/router";

const t = (id: string, type: TriggerDef["type"], config: TriggerDef["config"] = {}, extra: Partial<TriggerDef> = {}): TriggerDef =>
  ({ id, type, config, enabled: true, priority: 0, ...extra });

describe("text matching", () => {
  it("normalizes accents, case and punctuation", () => {
    expect(normalizeText("  ¿Cuánto CUESTA?! ")).toBe("cuanto cuesta");
  });
  it("contains matches whole words only", () => {
    expect(keywordMatches("quiero el precio por favor", ["precio"], "contains")).toBe(true);
    expect(keywordMatches("preciosa foto", ["precio"], "contains")).toBe(false);
  });
  it("exact requires the full message", () => {
    expect(keywordMatches("Precio", ["precio"], "exact")).toBe(true);
    expect(keywordMatches("precio y envio", ["precio"], "exact")).toBe(false);
  });
});

describe("routeEvent (messages)", () => {
  const triggers = [t("def", "default"), t("wel", "welcome"), t("kw", "keyword", { keywords: ["precio", "costo"] }),
    t("pb", "postback", { payload: "PRICES" })];

  it("keyword beats welcome and default", () => {
    expect(routeEvent({ kind: "message", text: "cual es el precio", isFirstContact: true }, triggers)?.id).toBe("kw");
  });
  it("quick reply payload beats keyword", () => {
    expect(routeEvent({ kind: "message", text: "precio", quickReplyPayload: "PRICES", isFirstContact: false }, triggers)?.id).toBe("pb");
  });
  it("welcome only for first contact, otherwise default", () => {
    expect(routeEvent({ kind: "message", text: "hola", isFirstContact: true }, triggers)?.id).toBe("wel");
    expect(routeEvent({ kind: "message", text: "hola", isFirstContact: false }, triggers)?.id).toBe("def");
  });
  it("ignores disabled triggers and returns null when nothing matches", () => {
    const off = triggers.map((x) => ({ ...x, enabled: false }));
    expect(routeEvent({ kind: "message", text: "precio", isFirstContact: true }, off)).toBeNull();
  });
  it("higher priority wins within a type", () => {
    const two = [t("a", "keyword", { keywords: ["hola"] }, { priority: 1 }), t("b", "keyword", { keywords: ["hola"] }, { priority: 5 })];
    expect(routeEvent({ kind: "message", text: "hola", isFirstContact: false }, two)?.id).toBe("b");
  });
});

describe("routeEvent (comments, stories, postbacks)", () => {
  it("comment trigger filters by media and keywords; ignores replies", () => {
    const ct = [t("c1", "comment", { mediaIds: ["m1"], keywords: ["quiero"] }), t("c2", "comment")];
    expect(routeEvent({ kind: "comment", text: "Quiero uno", mediaId: "m1", isReply: false }, ct)?.id).toBe("c1");
    expect(routeEvent({ kind: "comment", text: "Quiero uno", mediaId: "m9", isReply: false }, ct)?.id).toBe("c2");
    expect(routeEvent({ kind: "comment", text: "Quiero uno", mediaId: "m1", isReply: true }, ct)).toBeNull();
  });
  it("story mention and postback", () => {
    expect(routeEvent({ kind: "storyMention" }, [t("s", "storyMention")])?.id).toBe("s");
    expect(routeEvent({ kind: "postback", payload: "X" }, [t("p", "postback", { payload: "Y" })])).toBeNull();
  });
});
