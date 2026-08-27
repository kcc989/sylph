export type DiscoveredProviderModel = {
  providerId: string
  modelId: string
  name: string
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
