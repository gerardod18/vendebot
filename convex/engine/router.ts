/** Pure trigger matching. See docs/ARCHITECTURE.md §4. No Convex imports so it is trivially testable. */

export type TriggerType = "welcome" | "keyword" | "default" | "comment" | "storyMention" | "postback";

export type TriggerDef = {
  id: string;
  type: TriggerType;
  enabled: boolean;
  priority: number; // higher wins within the same type
  config: {
    keywords?: string[];
    match?: "exact" | "contains";
    mediaIds?: string[]; // comment triggers: restrict to these media; empty/undefined = any
    payload?: string; // postback triggers
  };
};

export type RouteInput =
  | { kind: "message"; text?: string; quickReplyPayload?: string; isFirstContact: boolean }
  | { kind: "comment"; text: string; mediaId?: string; isReply: boolean }
  | { kind: "storyMention" }
  | { kind: "postback"; payload: string };

/** Lowercase, strip accents and collapse whitespace/punctuation edges so "¿Precio?" matches "precio". */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function keywordMatches(text: string, keywords: string[], mode: "exact" | "contains"): boolean {
  const t = normalizeText(text);
  if (!t) return false;
  return keywords.some((k) => {
    const nk = normalizeText(k);
    if (!nk) return false;
    if (mode === "exact") return t === nk;
    return ` ${t} `.includes(` ${nk} `);
  });
}

const byPriority = (a: TriggerDef, b: TriggerDef) => b.priority - a.priority;

/** Returns the trigger to fire, or null. Order: postback/quick reply → keyword → welcome → default. */
export function routeEvent(input: RouteInput, triggers: TriggerDef[]): TriggerDef | null {
  const active = triggers.filter((t) => t.enabled);
  const of = (type: TriggerType) => active.filter((t) => t.type === type).sort(byPriority);

  switch (input.kind) {
    case "postback":
      return of("postback").find((t) => t.config.payload === input.payload) ?? null;

    case "storyMention":
      return of("storyMention")[0] ?? null;

    case "comment": {
      if (input.isReply) return null; // only top-level comments start a comment-to-DM
      return (
        of("comment").find((t) => {
          const media = t.config.mediaIds;
          if (media && media.length > 0 && (!input.mediaId || !media.includes(input.mediaId))) return false;
          const kws = t.config.keywords;
          if (!kws || kws.length === 0) return true;
          return keywordMatches(input.text, kws, t.config.match ?? "contains");
        }) ?? null
      );
    }

    case "message": {
      if (input.quickReplyPayload) {
        const q = of("postback").find((t) => t.config.payload === input.quickReplyPayload);
        if (q) return q;
      }
      if (input.text) {
        const k = of("keyword").find((t) =>
          keywordMatches(input.text!, t.config.keywords ?? [], t.config.match ?? "contains"),
        );
        if (k) return k;
      }
      if (input.isFirstContact) {
        const w = of("welcome")[0];
        if (w) return w;
      }
      return of("default")[0] ?? null;
    }
  }
}
