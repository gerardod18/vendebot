/**
 * Account identity rules. A connected channel account is unique per (channel, igUserId) among rows that are not
 * revoked. A revoked row stays with the workspace that owned it (its contacts, conversations and triggers remain
 * attached to it) and is never adopted by another workspace: a new workspace connecting the same id gets a NEW row.
 * So lookups by igUserId must tolerate several rows and only ever pick the live one.
 */
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { IgApiError } from "../instagram/client";

export type AccountChannel = "instagram" | "whatsapp";
export const channelOf = (a: { channel?: AccountChannel }): AccountChannel => a.channel ?? "instagram";

/** Every row (any status, any workspace) for this channel + id. Bounded: ids are reused only by reconnects. */
export async function rowsFor(ctx: Pick<QueryCtx, "db">, channel: AccountChannel, igUserId: string): Promise<Doc<"igAccounts">[]> {
  const rows = await ctx.db.query("igAccounts").withIndex("by_igUserId", (q) => q.eq("igUserId", igUserId)).take(50);
  return rows.filter((r) => channelOf(r) === channel);
}

/** The one row that may receive traffic for this id: status `active` only. */
export async function findActiveAccount(ctx: Pick<QueryCtx, "db">, channel: AccountChannel, igUserId: string): Promise<Doc<"igAccounts"> | null> {
  return (await rowsFor(ctx, channel, igUserId)).find((r) => r.status === "active") ?? null;
}

/** Same error for every cross-workspace conflict so it never reveals where the account is connected. */
export const ACCOUNT_UNAVAILABLE = "No pudimos conectar esta cuenta. Revisa los datos o contacta a soporte.";

/**
 * Meta errors that say nothing about the credentials: network failures, 5xx, 429 and Meta's transient codes.
 * Everything else from the Graph API (code 190, other 4xx) means the token / id is wrong.
 */
export function isTransientMetaError(e: unknown): boolean {
  return !(e instanceof IgApiError) || e.retryable;
}
