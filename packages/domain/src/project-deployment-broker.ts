import { Schema } from "effect"
import { ProjectResourcePlan } from "./project-resources"

export const DeploymentCapability = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  accountId: Schema.String,
  scope: Schema.String,
  runId: Schema.String,
  planJson: Schema.String,
  expiresAt: Schema.Number,
  revoked: Schema.Boolean,
})
export type DeploymentCapability = typeof DeploymentCapability.Type
export const BrokerPlan = ProjectResourcePlan
export const BrokerResource = Schema.Struct({
  kind: Schema.String,
  name: Schema.String,
  id: Schema.String,
})
export type BrokerResource = typeof BrokerResource.Type
export const BrokerJson = Schema.Record(Schema.String, Schema.Unknown)
export const BrokerBinding = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
})
export class DeploymentBrokerFailure extends Schema.TaggedError<DeploymentBrokerFailure>()(
  "DeploymentBrokerFailure",
  { message: Schema.String }
) {}

export const BrokerCollectionPage = Schema.Struct({
  total_pages: Schema.optional(Schema.Number),
  cursor: Schema.optional(Schema.NullOr(Schema.String)),
})
