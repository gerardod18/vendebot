import { describe, expect, it } from "vitest";
import { computeSignature, verifySignature } from "../convex/instagram/signature";

describe("verifySignature", () => {
  const secret = "app-secret";
  const body = JSON.stringify({ object: "instagram", entry: [] });

  it("accepts a valid signature", async () => {
    const sig = await computeSignature(body, secret);
    expect(await verifySignature(body, `sha256=${sig}`, secret)).toBe(true);
  });
  it("rejects a tampered body", async () => {
    const sig = await computeSignature(body, secret);
    expect(await verifySignature(body + " ", `sha256=${sig}`, secret)).toBe(false);
  });
  it("rejects a wrong secret, missing or malformed header", async () => {
    const sig = await computeSignature(body, secret);
    expect(await verifySignature(body, `sha256=${sig}`, "other")).toBe(false);
    expect(await verifySignature(body, null, secret)).toBe(false);
    expect(await verifySignature(body, sig, secret)).toBe(false); // missing "sha256=" prefix
    expect(await verifySignature(body, "sha256=zz", secret)).toBe(false);
  });
});
