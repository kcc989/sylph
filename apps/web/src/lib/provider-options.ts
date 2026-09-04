import type { OpenCodeKeyProviderId } from "@workspace/domain"

export interface ProviderOption {
  id: OpenCodeKeyProviderId
  name: string
  description: string
  apiKeyLabel: string
  apiKeyPlaceholder: string
  helpUrl: string
  requiresAccountId: boolean
}

export const providerOptions: ReadonlyArray<ProviderOption> = [
  {
    id: "openai",
    name: "OpenAI API",
    description: "Use metered API billing from the OpenAI Platform.",
    apiKeyLabel: "OpenAI API key",
    apiKeyPlaceholder: "sk-…",
    helpUrl: "https://opencode.ai/docs/providers/#openai",
    requiresAccountId: false,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "Use models available through your OpenRouter account.",
    apiKeyLabel: "OpenRouter API key",
    apiKeyPlaceholder: "sk-or-v1-…",
    helpUrl: "https://opencode.ai/docs/providers/#openrouter",
    requiresAccountId: false,
  },
  {
    id: "cloudflare-workers-ai",
    name: "Cloudflare Workers AI",
    description: "Run models through Workers AI in your Cloudflare account.",
    apiKeyLabel: "Cloudflare API token",
    apiKeyPlaceholder: "API token",
    helpUrl: "https://opencode.ai/docs/providers/#cloudflare-workers-ai",
    requiresAccountId: true,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Use Claude models with an Anthropic Console API key.",
    apiKeyLabel: "Anthropic API key",
    apiKeyPlaceholder: "sk-ant-…",
    helpUrl: "https://opencode.ai/docs/providers/#anthropic",
    requiresAccountId: false,
  },
  {
    id: "opencode",
    name: "OpenCode Zen / Go",
    description: "Use the model catalog attached to your OpenCode API key.",
    apiKeyLabel: "OpenCode API key",
    apiKeyPlaceholder: "opk_…",
    helpUrl: "https://opencode.ai/docs/providers/#opencode-zen",
    requiresAccountId: false,
  },
]

export const findProviderOption = (providerId: string) =>
  providerOptions.find((provider) => provider.id === providerId)

export const providerDisplayName = (providerId: string) =>
  providerId === "cursor"
    ? "Cursor"
    : providerId === "openai"
      ? "OpenAI"
      : (findProviderOption(providerId)?.name ?? providerId)

export const providerConfiguration = (
  provider: ProviderOption,
  accountId: string
) => (provider.requiresAccountId ? { accountId: accountId.trim() } : undefined)
