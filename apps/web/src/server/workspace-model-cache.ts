import type { Model } from "@opencode-ai/schema/model"

export const workspaceModelCacheBody = (
  providerId: string,
  modelId: string,
  body?: Model.Info["body"]
) =>
  providerId === "openrouter" && modelId.startsWith("anthropic/")
    ? { cache_control: { type: "ephemeral" }, ...body }
    : body
