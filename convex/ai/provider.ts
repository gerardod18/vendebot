import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { decryptSecret } from "../lib/crypto";
import { resolveModel, type AiSettingsLike } from "./models";

/**
 * Build an AI SDK language model for an org's settings.
 * Key precedence: org BYO key (decrypted here, never logged) then the platform env var.
 * Only call from actions / Node-compatible runtime code, never from queries or mutations.
 */
export async function getLanguageModel(settings: AiSettingsLike): Promise<LanguageModel> {
  const r = resolveModel(settings);
  let apiKey: string | undefined;
  if (r.byoKeyEnc) {
    const encKey = process.env.TOKEN_ENCRYPTION_KEY;
    if (!encKey) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
    apiKey = await decryptSecret(r.byoKeyEnc, encKey);
  } else {
    apiKey = process.env[r.platformKeyEnv];
  }
  if (!apiKey) throw new Error(`No API key for ${r.provider}: set ${r.platformKeyEnv} or an org key`);

  if (r.provider === "openrouter") {
    return createOpenRouter({ apiKey })(r.modelId);
  }
  return createAnthropic({ apiKey })(r.modelId);
}
