/** Verification of Meta's `X-Hub-Signature-256` header (HMAC-SHA256 of the raw body with the app secret). */

const encoder = new TextEncoder();

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function computeSignature(rawBody: string, appSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Returns true when `header` (format `sha256=<hex>`) matches the body. Uses the constant-time `verify`. */
export async function verifySignature(
  rawBody: string,
  header: string | null | undefined,
  appSecret: string,
): Promise<boolean> {
  if (!header || !appSecret) return false;
  const match = /^sha256=([0-9a-f]+)$/i.exec(header.trim());
  if (!match) return false;
  const expected = hexToBytes(match[1]);
  if (!expected) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, expected, encoder.encode(rawBody));
}
