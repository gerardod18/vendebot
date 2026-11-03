/**
 * Automation templates: form values → validated flow Graph. The UI shows a form per template; the
 * backend stores both the form values (flows.templateConfig) and the generated graph (flowVersions.graph).
 */
import { validateGraph, type Graph } from "./graph";

export type TemplateKey = "keywordReply" | "welcome" | "defaultReply" | "commentToDm" | "storyMention";

export type QuickReplyInput = { title: string; payload: string };

export type TemplateConfig =
  | { key: "keywordReply" | "welcome" | "storyMention" | "commentToDm"; text: string; quickReplies?: QuickReplyInput[]; handoffAfter?: boolean }
  | {
      key: "defaultReply";
      /** Sent when AI is unavailable (outside hours / quota exhausted). */
      fallbackText: string;
      /** When set, an AI agent answers during business hours. */
      ai?: { instructions: string; exitWhen?: string; timeoutMinutes?: number };
    };

function simpleMessage(text: string, quickReplies?: QuickReplyInput[], handoffAfter?: boolean): Graph {
  const nodes: Graph["nodes"] = [];
  const edges: Graph["edges"] = [];
  if (quickReplies?.length) nodes.push({ id: "m1", type: "quickReplies", text, options: quickReplies });
  else nodes.push({ id: "m1", type: "message", text });
  if (handoffAfter) {
    nodes.push({ id: "h1", type: "handoff" });
    if (!quickReplies?.length) edges.push({ from: "m1", port: "next", to: "h1" });
    else for (const q of quickReplies) edges.push({ from: "m1", port: q.payload, to: "h1" });
  }
  return { startNodeId: "m1", nodes, edges };
}

export function buildGraph(cfg: TemplateConfig): Graph {
  let graph: Graph;
  if (cfg.key === "defaultReply") {
    if (!cfg.ai) {
      graph = { startNodeId: "m1", nodes: [{ id: "m1", type: "message", text: cfg.fallbackText }], edges: [] };
    } else {
      // Mirrors SendPulse's default flow: filter (hours + AI quota) → AI agent, else fallback message.
      graph = {
        startNodeId: "f1",
        nodes: [
          { id: "f1", type: "filter", mode: "all", conditions: [{ kind: "businessHours" }, { kind: "aiQuotaAvailable" }] },
          {
            id: "ai1", type: "aiAgent", instructions: cfg.ai.instructions, exitWhen: cfg.ai.exitWhen ?? "",
            timeoutMinutes: cfg.ai.timeoutMinutes ?? 60, useKnowledge: true,
          },
          { id: "m1", type: "message", text: cfg.fallbackText },
          { id: "h1", type: "handoff" },
        ],
        edges: [
          { from: "f1", port: "yes", to: "ai1" },
          { from: "f1", port: "no", to: "m1" },
          { from: "ai1", port: "exit", to: "h1" },
          { from: "ai1", port: "quota", to: "m1" },
        ],
      };
    }
  } else {
    graph = simpleMessage(cfg.text, cfg.quickReplies, cfg.handoffAfter);
  }
  const v = validateGraph(graph);
  if (!v.ok) throw new Error(`template produced an invalid graph: ${v.errors.join("; ")}`);
  return v.graph;
}

import { z } from "zod";

const qr = z.object({ title: z.string().min(1).max(20), payload: z.string().min(1).max(200) });

export const templateConfigSchema = z.discriminatedUnion("key", [
  z.object({
    key: z.enum(["keywordReply", "welcome", "storyMention", "commentToDm"]),
    text: z.string().min(1).max(1000),
    quickReplies: z.array(qr).max(13).optional(),
    handoffAfter: z.boolean().optional(),
  }),
  z.object({
    key: z.literal("defaultReply"),
    fallbackText: z.string().min(1).max(1000),
    ai: z
      .object({
        instructions: z.string().min(1).max(4000),
        exitWhen: z.string().max(500).optional(),
        timeoutMinutes: z.number().int().min(1).max(10080).optional(),
      })
      .optional(),
  }),
]);

/** Which trigger type each template installs. */
export const TEMPLATE_TRIGGER: Record<TemplateKey, "keyword" | "welcome" | "default" | "comment" | "storyMention"> = {
  keywordReply: "keyword",
  welcome: "welcome",
  defaultReply: "default",
  commentToDm: "comment",
  storyMention: "storyMention",
};
