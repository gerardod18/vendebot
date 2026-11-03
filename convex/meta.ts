import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { parseWebhook } from "./instagram/parse";
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
    await ctx.runMutation(internal.engine.ingest.ingestEvents, { events });
    // TODO(phase 4): enqueue processing of `accepted` events on the eventPool Workpool.
  }
  // Meta expects 200 quickly; anything non-2xx makes it retry.
  return new Response("ok", { status: 200 });
});
