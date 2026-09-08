import type { ModelInfo } from "cursor-opencode-provider/models"
import type { CursorModelCall } from "@workspace/domain/cursor-provider"

export const cursorModelOptions = (
  options: CursorModelCall["options"],
  model: ModelInfo
): CursorModelCall["options"] => {
  const cursor = options.providerOptions?.cursor
  const requiresMaxMode =
    model.variants.some((variant) => variant.isDefaultMax) &&
    !model.variants.some((variant) => variant.isDefaultNonMax)
  return {
    ...options,
    providerOptions: {
      ...options.providerOptions,
      cursor: {
        ...cursor,
        maxMode: cursor?.maxMode ?? requiresMaxMode,
      },
    },
  }
}
