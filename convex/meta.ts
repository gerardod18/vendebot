import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { exchangeLongLivedToken } from "./instagram/client";
import { exchangeCode, fetchOwnProfile } from "./instagram/oauth";
import { parseWebhook } from "./instagram/parse";
import { parseSignedRequest } from "./instagram/signedRequest";
import { encryptSecret } from "./lib/crypto";
import { verifySignature } from "./instagram/signature";

/** GET /meta/webhook: Meta's subscription handshake. */
export const verifyWebhook = httpAction(async (_ctx, request) => {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
});

/** POST /meta/webhook: verify signature, parse, store (idempotently). Always fast; heavy work is async. */
export const receiveWebhook = httpAction(async (ctx, request) => {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return new Response("Server not configured", { status: 500 });

  const raw = await request.text();
  const ok = await verifySignature(raw, request.headers.get("x-hub-signature-256"), secret);
  if (!ok) return new Response("Invalid signature", { status: 401 });

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const events = parseWebhook(body);
  if (events.length > 0) {
    const { accepted } = await ctx.runMutation(internal.engine.ingest.ingestEvents, { events });
    // Process each NEW event asynchronously so Meta gets its 200 fast (D10: scheduler, not Workpool).
    for (const a of accepted) {
      await ctx.scheduler.runAfter(0, internal.engine.runner.processInbound, {
        event: a.event,
        conversationId: a.conversationId as any,
        contactId: a.contactId as any,
        igAccountId: a.igAccountId as any,
        isFirstContact: a.isFirstContact,
      });
    }
  }
  // Meta expects 200 quickly; anything non-2xx makes it retry.
  return new Response("ok", { status: 200 });
});

const back = (path: string) => new Response(null, { status: 302, headers: { Location: `${process.env.SITE_URL ?? ""}${path}` } });

/** GET /meta/oauth/callback: finish "Connect Instagram", then redirect back to the app. */
export const oauthCallback = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error") || !code || !state) return back("/accounts?error=denied");

  const who = await ctx.runMutation(internal.accounts.consumeState, { state });
  if (!who) return back("/accounts?error=state");

  const appId = process.env.META_APP_ID, appSecret = process.env.META_APP_SECRET, site = process.env.CONVEX_SITE_URL;
  const encKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!appId || !appSecret || !site || !encKey) return back("/accounts?error=config");
  try {
    const short = await exchangeCode({ code, appId, appSecret, redirectUri: `${site}/meta/oauth/callback` });
    const long = await exchangeLongLivedToken(short.accessToken, appSecret);
    const profile = await fetchOwnProfile(long.accessToken, process.env.META_GRAPH_VERSION);
    const igUserId = profile.igUserId || short.igUserId;
    const accountId = await ctx.runMutation(internal.accounts.upsertAccount, {
      orgId: who.orgId, userId: who.userId, igUserId, username: profile.username,
      name: profile.name, profilePictureUrl: profile.profilePictureUrl,
      tokenEnc: await encryptSecret(long.accessToken, encKey), tokenExpiresAt: long.expiresAt,
    });
    await ctx.scheduler.runAfter(0, internal.accounts.subscribeWebhooks, { accountId, igUserId, token: long.accessToken });
    return back("/accounts?connected=1");
  } catch (e) {
    const taken = e instanceof Error && e.message.includes("another workspace");
    return back(`/accounts?error=${taken ? "taken" : "failed"}`);
  }
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function signedUserId(request: Request): Promise<string | null> {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return null;
  const signed = (await request.formData().catch(() => null))?.get("signed_request");
  if (typeof signed !== "string") return null;
  const payload = await parseSignedRequest(signed, secret);
  return payload?.user_id ? String(payload.user_id) : null;
}

/** POST /meta/data-deletion: Meta "Data Deletion Request Callback". Deletes the user's data, returns a status URL. */
export const dataDeletion = httpAction(async (ctx, request) => {
  const userId = await signedUserId(request);
  if (!userId) return json({ error: "invalid signed_request" }, 400);
  const code = crypto.randomUUID();
  await ctx.runMutation(internal.privacy.deleteSubjectData, { subjectId: userId, code });
  return json({ url: `${process.env.SITE_URL ?? ""}/deletion?code=${code}`, confirmation_code: code });
});

/** POST /meta/deauthorize: the account owner removed the app in Instagram. Revoke the connection. */
export const deauthorize = httpAction(async (ctx, request) => {
  const userId = await signedUserId(request);
  if (!userId) return json({ error: "invalid signed_request" }, 400);
  await ctx.runMutation(internal.privacy.revokeAccountByIgUserId, { igUserId: userId });
  return json({ ok: true });
});
