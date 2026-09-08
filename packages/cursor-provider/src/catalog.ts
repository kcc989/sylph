import { modelsToConfig } from "cursor-opencode-provider/plugin"
import {
  CURSOR_WIRE_MODEL_ID_KEY,
  CURSOR_VARIANT_PARAMETERS_KEY,
  type ModelInfo,
} from "cursor-opencode-provider/models"
import {
  CursorModelConfiguration,
  CursorModels,
} from "@workspace/domain/cursor-provider"
import { Schema } from "effect"

const decodeConfiguration = Schema.decodeUnknownSync(CursorModelConfiguration)
const decodeModels = Schema.decodeUnknownSync(CursorModels)

export const cursorCatalog = (models: ModelInfo[]) => {
  const configuration = decodeConfiguration(
    modelsToConfig(models.filter((model) => model.supportsAgent !== false))
  )
  return decodeModels(
    Object.entries(configuration).map(([id, entry]) => ({
      id,
      modelId: entry.options?.[CURSOR_WIRE_MODEL_ID_KEY] ?? id,
      name: entry.name,
      context: entry.limit.context,
      output: entry.limit.output,
      images: entry.modalities?.input.includes("image") ?? false,
      settings: entry.options,
      variants: [
        ...Object.entries(entry.variants ?? {}).map(([id, settings]) => ({
          id,
          settings,
        })),
        ...(models.find((model) => model.id === id)?.supportsMaxMode &&
        !entry.options?.[CURSOR_VARIANT_PARAMETERS_KEY]
          ? [{ id: "Max", settings: { maxMode: true } }]
          : []),
      ],
    }))
  )
}
