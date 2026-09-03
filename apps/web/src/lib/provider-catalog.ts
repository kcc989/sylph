import { Schema } from "effect"

import { normalizeProviderModels } from "@/lib/provider-models"

const OpenCodeCatalogModel = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  status: Schema.optional(Schema.String),
  disabled: Schema.optional(Schema.Boolean),
})

const OpenCodeCatalogProvider = Schema.Struct({
  models: Schema.Record(Schema.String, OpenCodeCatalogModel),
})

const OpenCodeCatalog = Schema.Record(Schema.String, OpenCodeCatalogProvider)
export const decodeOpenCodeCatalog =
  Schema.decodeUnknownPromise(OpenCodeCatalog)

export const providerModelsFromOpenCodeCatalog = (
  catalog: typeof OpenCodeCatalog.Type,
  providerId: string
) => {
  const provider = catalog[providerId]
  if (!provider)
    throw new Error(`OpenCode catalog has no ${providerId} provider`)

  const models = normalizeProviderModels(
    Object.values(provider.models)
      .filter(
        (model) => model.disabled !== true && model.status !== "deprecated"
      )
      .map((model) => ({
        providerId,
        modelId: model.id,
        name: model.name,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    providerId
  )
  if (!models.length) {
    throw new Error(`OpenCode catalog has no usable ${providerId} models`)
  }
  return models
}

export const fetchOpenCodeProviderModels = async (
  providerId: string,
  fetcher: typeof fetch = fetch
) => {
  const response = await fetcher("https://models.opencode.ai/api.json", {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    throw new Error(`OpenCode catalog request failed with ${response.status}`)
  }
  const catalog = await decodeOpenCodeCatalog(await response.json())
  return providerModelsFromOpenCodeCatalog(catalog, providerId)
}
