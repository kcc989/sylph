import { providerDisplayName } from "./provider-options"

export type ModelScope = "personal" | "organization"

export interface AvailableModel {
  providerId: string
  modelId: string
  name: string
  providerName: string
  scope: ModelScope
}

export interface SelectedModel {
  providerId: string
  modelId: string
}

export interface ModelResolution {
  model: AvailableModel | null
  notice: string | null
  source: "conversation" | "personal" | "organization" | "fallback" | null
}

const matches = (model: AvailableModel, selection: SelectedModel) =>
  model.providerId === selection.providerId &&
  model.modelId === selection.modelId

const findModel = (
  models: ReadonlyArray<AvailableModel>,
  selection: SelectedModel | null | undefined
) =>
  selection ? (models.find((model) => matches(model, selection)) ?? null) : null

const describeSelection = (selection: SelectedModel) =>
  `${selection.providerId}/${selection.modelId}`

export const resolveModelSelection = ({
  models,
  conversation,
  personal,
  organization,
}: {
  models: ReadonlyArray<AvailableModel>
  conversation?: SelectedModel | null
  personal?: SelectedModel | null
  organization?: SelectedModel | null
}): ModelResolution => {
  const conversationModel = findModel(models, conversation)
  if (conversationModel) {
    return { model: conversationModel, notice: null, source: "conversation" }
  }

  const personalModel = findModel(models, personal)
  if (personalModel) {
    return {
      model: personalModel,
      notice: conversation
        ? `${describeSelection(conversation)} is unavailable. Using your default, ${personalModel.providerName} · ${personalModel.name}.`
        : null,
      source: "personal",
    }
  }

  const organizationModel = findModel(models, organization)
  if (organizationModel) {
    const unavailable = conversation ?? personal
    return {
      model: organizationModel,
      notice: unavailable
        ? `${describeSelection(unavailable)} is unavailable. Using the Organization default, ${organizationModel.providerName} · ${organizationModel.name}.`
        : null,
      source: "organization",
    }
  }

  const fallback =
    models.find(
      (model) =>
        model.providerId === "openrouter" && model.modelId === "openrouter/auto"
    ) ??
    models[0] ??
    null
  const unavailable = conversation ?? personal ?? organization
  return {
    model: fallback,
    notice:
      fallback && unavailable
        ? `${describeSelection(unavailable)} is unavailable. Using ${fallback.providerName} · ${fallback.name}.`
        : null,
    source: fallback ? "fallback" : null,
  }
}

export const providerName = providerDisplayName
