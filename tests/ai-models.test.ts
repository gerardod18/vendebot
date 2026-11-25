import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { resolveModel, validateModelId, defaultModelFor } from "../convex/ai/models";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
const setup = () => convexTest(schema, modules);
const as = (t: ReturnType<typeof setup>, userId: string) => t.withIdentity({ subject: userId });

describe("resolveModel", () => {
  it("defaults to anthropic with the platform key", () => {
    expect(resolveModel({ aiModel: "claude-haiku-5-5" })).toEqual({
      provider: "anthropic",
      modelId: "claude-haiku-5-5",
      byoKeyEnc: undefined,
      platformKeyEnv: "ANTHROPIC_API_KEY",
    });
  });

  it("uses the OpenRouter BYO key only for openrouter", () => {
    const s = { aiModel: "openai/gpt-5-mini", byoAnthropicKeyEnc: "a", byoOpenRouterKeyEnc: "o" };
    expect(resolveModel({ ...s, aiProvider: "openrouter" })).toMatchObject({
      provider: "openrouter",
      byoKeyEnc: "o",
      platformKeyEnv: "OPENROUTER_API_KEY",
    });
    expect(resolveModel({ ...s, aiProvider: "anthropic" }).byoKeyEnc).toBe("a");
  });
});

describe("validateModelId", () => {
  it("accepts OpenRouter slugs, including variants", () => {
    expect(validateModelId("openrouter", "openai/gpt-5-mini")).toBeNull();
    expect(validateModelId("openrouter", "meta-llama/llama-3.3-70b-instruct:free")).toBeNull();
    expect(validateModelId("openrouter", defaultModelFor("openrouter"))).toBeNull();
  });
  it("rejects malformed ids", () => {
    expect(validateModelId("openrouter", "gpt-5-mini")).not.toBeNull();
    expect(validateModelId("openrouter", "a/b c")).not.toBeNull();
    expect(validateModelId("anthropic", "openai/gpt-5")).not.toBeNull();
    expect(validateModelId("anthropic", "")).not.toBeNull();
  });
});
