import { Option, Schema } from "effect"
import { ModelReasoningSettings } from "@workspace/domain"
import type { OpenCodeWorkerd } from "@opencode-ai/sdk/workerd"
import type { ModelSelection, ModelThinkingOption } from "@workspace/domain"

type NativeModel = Awaited<
  ReturnType<OpenCodeWorkerd.Interface["model"]["list"]>
>["data"][number]
type ThinkingOption = typeof ModelThinkingOption.Type

export const findWorkspaceModel = (
  models: ReadonlyArray<
    Pick<
      NativeModel,
      "id" | "modelID" | "providerID" | "enabled" | "status" | "variants"
    >
  >,
  selection: ModelSelection
) => {
  const providerModels = models.filter(
    (model) =>
      model.providerID === selection.providerId &&
      model.enabled &&
      model.status !== "deprecated"
  )
  const exact = providerModels.find((model) => model.id === selection.modelId)
  if (exact) return exact
  const aliases = providerModels.filter(
    (model) => model.modelID === selection.modelId
  )
  return aliases.length === 1 ? aliases[0] : undefined
}

const effortLabels = new Map([
  ["none", "None"],
  ["minimal", "Minimal"],
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["xhigh", "Extra high"],
  ["max", "Max"],
  ["ultra", "Ultra"],
])
const decodeSettings = Schema.decodeUnknownOption(ModelReasoningSettings)

export const workspaceThinkingOptions = (
  model: Pick<NativeModel, "variants">
) => {
  const options = model.variants.flatMap<ThinkingOption>((variant) => {
    const settings = Option.getOrUndefined(
      decodeSettings(variant.settings ?? {})
    )
    const effort =
      settings?.reasoningEffort ??
      settings?.effort ??
      settings?.outputConfig?.effort ??
      settings?.thinkingConfig?.thinkingLevel
    const effortLabel = effort ? effortLabels.get(effort) : undefined
    if (effortLabel)
      return [
        {
          value: variant.id,
          label: effortLabel,
          kind: "effort" as const,
        },
      ]
    const variantLabel = effortLabels.get(variant.id)
    if (variantLabel && variant.id !== "none")
      return [
        {
          value: variant.id,
          label: variantLabel,
          kind: "effort" as const,
        },
      ]
    if (variant.id === "thinking" || settings?.thinking?.type === "enabled")
      return [{ value: variant.id, label: "On", kind: "toggle" as const }]
    if (variant.id === "none" || settings?.thinking?.type === "disabled")
      return [{ value: variant.id, label: "Off", kind: "toggle" as const }]
    return []
  })
  const kind: ThinkingOption["kind"] = options.some(
    (option) => option.kind === "effort"
  )
    ? "effort"
    : "toggle"
  return options.map((option) => ({
    value: option.value,
    label: kind === "effort" && option.label === "Off" ? "None" : option.label,
    kind,
  }))
}
