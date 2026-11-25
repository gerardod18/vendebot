/**
 * Pure AI model/provider resolution (no SDK imports, fully unit-testable).
 *
 * Providers:
 * - `anthropic`: direct Anthropic API. Model ids like `claude-haiku-5-5`.
 * - `openrouter`: OpenRouter (https://openrouter.ai). Model ids are `vendor/model`,
 *   e.g. `anthropic/claude-haiku-5-5`, `openai/gpt-5-mini`, `google/gemini-2.5-flash`.
 *
 * API key precedence: the key a superAdmin stored in the platform settings, then the platform env var.
 * (The `byo*` field names are historical: workspaces no longer bring their own keys, see D12.)
 */

export const AI_PROVIDERS = ["anthropic", "openrouter"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const DEFAULT_PROVIDER: AiProvider = "anthropic";
export const DEFAULT_MODEL = "claude-haiku-5-5";
export const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-haiku-5-5";

export const PLATFORM_KEY_ENV: Record<AiProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

export type AiSettingsLike = {
  aiProvider?: AiProvider;
  aiModel: string;
  byoAnthropicKeyEnc?: string;
  byoOpenRouterKeyEnc?: string;
};

export type ResolvedModel = {
  provider: AiProvider;
  modelId: string;
  /** Encrypted key stored in the platform settings, if any; otherwise read the platform env var. */
  byoKeyEnc: string | undefined;
  platformKeyEnv: string;
};

/** OpenRouter slugs look like `vendor/model` with optional `:variant` (e.g. `:free`, `:nitro`). */
const OPENROUTER_ID = /^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:+-]*$/;
const ANTHROPIC_ID = /^claude-[a-z0-9.-]+$/;

/** Returns an error message, or null when the model id is valid for the provider. */
export function validateModelId(provider: AiProvider, modelId: string): string | null {
  const id = modelId.trim();
  if (id.length === 0 || id.length > 120) return "Model id must be 1-120 characters";
  if (provider === "openrouter" && !OPENROUTER_ID.test(id)) {
    return "OpenRouter model ids look like vendor/model (e.g. openai/gpt-5-mini)";
  }
  if (provider === "anthropic" && !ANTHROPIC_ID.test(id)) {
    return "Anthropic model ids look like claude-haiku-5-5";
  }
  return null;
}

/** Default model to suggest when the provider is switched. */
export function defaultModelFor(provider: AiProvider): string {
  return provider === "openrouter" ? DEFAULT_OPENROUTER_MODEL : DEFAULT_MODEL;
}

export function resolveModel(s: AiSettingsLike): ResolvedModel {
  const provider = s.aiProvider ?? DEFAULT_PROVIDER;
  return {
    provider,
    modelId: s.aiModel,
    byoKeyEnc: provider === "openrouter" ? s.byoOpenRouterKeyEnc : s.byoAnthropicKeyEnc,
    platformKeyEnv: PLATFORM_KEY_ENV[provider],
  };
}
