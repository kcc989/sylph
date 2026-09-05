import { Schema } from "effect"
import { InvalidRequest } from "./errors"
import { ModelSelection } from "./provider-connection"

export const InstanceModelIdentity = Schema.Struct({
  providerId: ModelSelection.fields.providerId,
  modelId: ModelSelection.fields.modelId,
})
export type InstanceModelIdentity = typeof InstanceModelIdentity.Type

export const InstanceModelPolicy = Schema.Struct({
  models: Schema.Array(InstanceModelIdentity),
  defaultModel: Schema.NullOr(InstanceModelIdentity),
})
export type InstanceModelPolicy = typeof InstanceModelPolicy.Type

export const instanceModelKey = (model: InstanceModelIdentity) =>
  JSON.stringify([model.providerId, model.modelId])

export const instanceModelEnabled = (
  policy: InstanceModelPolicy,
  model: InstanceModelIdentity
) =>
  policy.models.some(
    (candidate) => instanceModelKey(candidate) === instanceModelKey(model)
  )

export const validateInstanceModelPolicy = (
  policy: InstanceModelPolicy,
  knownModels: ReadonlyArray<InstanceModelIdentity>
) => {
  const known = new Set(knownModels.map(instanceModelKey))
  if (policy.models.some((model) => !known.has(instanceModelKey(model))))
    throw new InvalidRequest({
      message: "Choose models from the connected provider catalog",
    })
  if (
    new Set(policy.models.map(instanceModelKey)).size !== policy.models.length
  )
    throw new InvalidRequest({
      message: "Each model can only be selected once",
    })
  if (
    policy.models.length
      ? !policy.defaultModel ||
        !instanceModelEnabled(policy, policy.defaultModel)
      : policy.defaultModel !== null
  )
    throw new InvalidRequest({
      message: "Choose an enabled default model, or disable all models",
    })
}
