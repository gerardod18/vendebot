/** Estimated LLM cost. USD per 1M tokens == micro-USD per token. Unknown models cost 0 (flagged by `known`). */
const PRICES: { match: RegExp; input: number; output: number }[] = [
  { match: /haiku/, input: 0.1, output: 0.5 },
  { match: /sonnet/, input: 2, output: 10 },
  { match: /opus/, input: 4, output: 20 },
];

export function estimateCostMicros(modelId: string, inputTokens: number, outputTokens: number): { micros: number; known: boolean } {
  const p = PRICES.find((x) => x.match.test(modelId));
  if (!p) return { micros: 0, known: false };
  return { micros: Math.round(inputTokens * p.input + outputTokens * p.output), known: true };
}
