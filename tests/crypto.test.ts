import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../convex/lib/crypto";

const key = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1)));

describe("crypto", () => {
  it("round-trips", async () => {
    const enc = await encryptSecret("IGQVJ-token", key);
    expect(enc).not.toContain("IGQVJ");
    expect(await decryptSecret(enc, key)).toBe("IGQVJ-token");
  });
  it("uses a fresh IV each time", async () => {
    expect(await encryptSecret("x", key)).not.toBe(await encryptSecret("x", key));
  });
  it("fails with the wrong key or tampered data", async () => {
    const enc = await encryptSecret("secret", key);
    const other = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
    await expect(decryptSecret(enc, other)).rejects.toThrow();
    const bytes = atob(enc).split("");
    bytes[20] = String.fromCharCode(bytes[20].charCodeAt(0) ^ 1);
    await expect(decryptSecret(btoa(bytes.join("")), key)).rejects.toThrow();
  });
  it("rejects a key of the wrong length", async () => {
    await expect(encryptSecret("x", btoa("short"))).rejects.toThrow(/32 bytes/);
  });
});
