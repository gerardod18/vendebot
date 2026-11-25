/** Instagram messaging-window rules (UNVERIFIED numbers, see META_SETUP.md): 24h standard, 7 days with HUMAN_AGENT tag. */
export const HOUR = 3600_000;
export type WindowDecision = "ok" | "human_agent_tag" | "closed";

export function checkWindow(
  lastInboundAt: number | undefined,
  now: number,
  opts: { humanAgent?: boolean; privateReply?: boolean } = {},
): WindowDecision {
  if (opts.privateReply) return "ok"; // private replies to comments have their own 7-day rule, enforced by Meta
  if (lastInboundAt === undefined) return "closed";
  const age = now - lastInboundAt;
  if (age <= 24 * HOUR) return "ok";
  if (opts.humanAgent && age <= 7 * 24 * HOUR) return "human_agent_tag";
  return "closed";
}
