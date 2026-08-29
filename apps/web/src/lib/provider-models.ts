export type DiscoveredProviderModel = {
  providerId: string
  modelId: string
  name: string
}

export const bootstrapProviderModels = (
  providerId: string
): ReadonlyArray<DiscoveredProviderModel> => {
  if (providerId !== "openrouter") return []

  return [
    {
      providerId: "openrouter",
      modelId: "openrouter/auto",
      name: "Auto Router",
    },
    {
      providerId: "openrouter",
      modelId: "deepseek/deepseek-v4-flash-0731",
      name: "DeepSeek V4 Flash 0731",
    },
  ]
}

export const normalizeProviderModels = (
  models: ReadonlyArray<DiscoveredProviderModel>,
  providerId: string
) => {
  const seenModelIds = new Set<string>()

  return models.filter((model) => {
    if (model.providerId !== providerId || seenModelIds.has(model.modelId)) {
      return false
    }

    seenModelIds.add(model.modelId)
    return true
  })
}

export const selectInitialProviderModel = (
  models: ReadonlyArray<DiscoveredProviderModel>,
  providerId: string,
  recommendedModelId: string | null
) => {
  const preferredModelId =
    providerId === "openai" ? "gpt-5.6-sol" : recommendedModelId

  return (
    models.find(
      (model) =>
        model.providerId === providerId && model.modelId === preferredModelId
    ) ??
    models.find(
      (model) =>
        model.providerId === providerId && model.modelId === recommendedModelId
    ) ??
    models.find((model) => model.providerId === providerId)
  )
}
