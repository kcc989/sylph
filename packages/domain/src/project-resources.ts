import { Schema } from "effect"

export const ProjectResourceKind = Schema.Literals([
  "worker",
  "d1",
  "kv",
  "r2",
  "queue",
  "domain",
  "durable_object",
  "workflow",
])
export type ProjectResourceKind = typeof ProjectResourceKind.Type

export const ProjectResourceBinding = Schema.Struct({
  type: Schema.Literals([
    "r2_bucket",
    "kv_namespace",
    "queue",
    "durable_object_namespace",
    "workflow",
    "service",
    "ai",
  ]),
  name: Schema.NonEmptyString,
  target: Schema.optional(Schema.NonEmptyString),
  entrypoint: Schema.optional(Schema.NonEmptyString),
})

export const ProjectResourcePurpose = Schema.Literals([
  "application",
  "recovery_control",
])

export const PlannedProjectResource = Schema.Struct({
  kind: ProjectResourceKind,
  name: Schema.NonEmptyString,
  worker: Schema.optional(Schema.NonEmptyString),
  className: Schema.optional(Schema.NonEmptyString),
  entrypoint: Schema.optional(Schema.Boolean),
  adopted: Schema.optional(Schema.Boolean),
  purpose: Schema.optional(ProjectResourcePurpose),
  bindings: Schema.optional(Schema.Array(ProjectResourceBinding)),
})
export type PlannedProjectResource = typeof PlannedProjectResource.Type

export const ProjectResourcePlan = Schema.Array(PlannedProjectResource)
export type ProjectResourcePlan = typeof ProjectResourcePlan.Type

export const StoredProjectResource = Schema.Struct({
  account_id: Schema.NonEmptyString,
  project_id: Schema.NonEmptyString,
  scope: Schema.NonEmptyString,
  kind: ProjectResourceKind,
  name: Schema.NonEmptyString,
  resource_id: Schema.NullOr(Schema.String),
  generation: Schema.NullOr(Schema.String),
  purpose: Schema.optional(ProjectResourcePurpose),
  state: Schema.Literals(["reserved", "active", "retired", "deleted"]),
})
export type StoredProjectResource = typeof StoredProjectResource.Type

export const CloudflareResourceResponse = Schema.Struct({
  success: Schema.Boolean,
  result: Schema.Unknown,
  result_info: Schema.optional(
    Schema.Struct({
      total_pages: Schema.optional(Schema.Number),
      cursor: Schema.optional(Schema.NullOr(Schema.String)),
    })
  ),
})
export const CloudflareWorkers = Schema.Array(
  Schema.Struct({ id: Schema.String, created_on: Schema.NonEmptyString })
)
export const CloudflareDatabases = Schema.Array(
  Schema.Struct({ uuid: Schema.String, name: Schema.String })
)
export const CloudflareNamespaces = Schema.Array(
  Schema.Struct({ id: Schema.String, title: Schema.String })
)
export const CloudflareBuckets = Schema.Struct({
  buckets: Schema.Array(
    Schema.Struct({ name: Schema.String, creation_date: Schema.NonEmptyString })
  ),
})
export const CloudflareQueues = Schema.Array(
  Schema.Struct({ queue_id: Schema.String, queue_name: Schema.String })
)
export const CloudflareQueueConsumers = Schema.Array(
  Schema.Struct({
    consumer_id: Schema.NonEmptyString,
    type: Schema.String,
    script: Schema.optional(Schema.NullOr(Schema.String)),
    script_name: Schema.optional(Schema.NullOr(Schema.String)),
  })
)
export const CloudflareWorkerBindings = Schema.Struct({
  containers: Schema.optional(Schema.Array(Schema.Unknown)),
  tail_consumers: Schema.optional(
    Schema.Array(Schema.Struct({ service: Schema.String }))
  ),
  bindings: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      name: Schema.String,
      id: Schema.optional(Schema.String),
      namespace_id: Schema.optional(Schema.String),
      bucket_name: Schema.optional(Schema.String),
      queue_name: Schema.optional(Schema.String),
      class_name: Schema.optional(Schema.String),
      script_name: Schema.optional(Schema.String),
      workflow_name: Schema.optional(Schema.String),
      service: Schema.optional(Schema.String),
      environment: Schema.optional(Schema.String),
      namespace: Schema.optional(Schema.String),
      dispatch_namespace: Schema.optional(Schema.String),
      jurisdiction: Schema.optional(Schema.String),
      entrypoint: Schema.optional(Schema.String),
    })
  ),
})

export const ProjectResourceOperation = Schema.Struct({
  account_id: Schema.String,
  project_id: Schema.String,
  scope: Schema.String,
  run_id: Schema.String,
  plan_json: Schema.String,
  status: Schema.Literals([
    "deploying",
    "retained",
    "cleanup_failed",
    "deleted",
    "complete",
    "maintaining",
  ]),
  error: Schema.NullOr(Schema.String),
  inspected_at: Schema.NullOr(Schema.Number),
})
export type ProjectResourceOperation = typeof ProjectResourceOperation.Type

export const ProjectResourceAction = Schema.Struct({
  projectId: Schema.NonEmptyString,
  scope: Schema.NonEmptyString,
  action: Schema.Literals(["inspect", "cleanup"]),
  confirmedScope: Schema.optional(Schema.String),
  confirmedRunId: Schema.optional(Schema.NonEmptyString),
  requestId: Schema.optional(Schema.NonEmptyString),
})
export const ProjectResourceMaintenance = Schema.Struct({
  projectId: Schema.NonEmptyString,
  scope: Schema.NonEmptyString,
  runId: Schema.NonEmptyString,
  accountId: Schema.NonEmptyString,
  action: Schema.Literals(["inspect", "cleanup", "adopt", "retire", "remove"]),
  reviewId: Schema.optional(Schema.NonEmptyString),
})
export type ProjectResourceMaintenance = typeof ProjectResourceMaintenance.Type

export const ProjectSecretInput = Schema.Struct({
  projectId: Schema.NonEmptyString,
  environment: Schema.Literals(["preview", "production"]),
  name: Schema.NonEmptyString,
  value: Schema.NullOr(Schema.String),
})
export const ProjectSecretValues = Schema.Record(Schema.String, Schema.String)
export const ProjectDomainInput = Schema.Struct({
  projectId: Schema.NonEmptyString,
  hostname: Schema.String,
  zoneId: Schema.String,
})
export const ProjectDomain = Schema.Struct({
  hostname: Schema.String,
  zone_id: Schema.String,
})
export const CloudflareDomains = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    hostname: Schema.String,
    service: Schema.String,
  })
)

export const CloudflareObjects = Schema.Array(
  Schema.Struct({ key: Schema.String })
)

export const CloudflareDurableObjects = Schema.Array(
  Schema.Struct({
    id: Schema.NonEmptyString,
    script: Schema.NonEmptyString,
    class: Schema.NonEmptyString,
  })
)
export const CloudflareContainerApplications = Schema.Array(
  Schema.Struct({
    id: Schema.String,
    durable_objects: Schema.optional(
      Schema.NullOr(Schema.Struct({ namespace_id: Schema.NonEmptyString }))
    ),
  })
)
export const CloudflareWorkflows = Schema.Array(
  Schema.Struct({
    id: Schema.NonEmptyString,
    name: Schema.NonEmptyString,
    script_name: Schema.NonEmptyString,
    class_name: Schema.NonEmptyString,
    created_on: Schema.NonEmptyString,
  })
)

export class ResourcePolicyError extends Schema.TaggedError<ResourcePolicyError>()(
  "ResourcePolicyError",
  {
    message: Schema.String,
  }
) {}

export const ResourceMutationAction = Schema.Literals([
  "adopt",
  "retire",
  "remove",
])
export const ResourceMutationInput = Schema.Struct({
  projectId: Schema.NonEmptyString,
  scope: Schema.Literal("production"),
  action: ResourceMutationAction,
  resources: ProjectResourcePlan,
})
export type ResourceMutationInput = typeof ResourceMutationInput.Type
export const ResourceMutationReview = Schema.Struct({
  id: Schema.NonEmptyString,
  accountId: Schema.NonEmptyString,
  projectId: Schema.NonEmptyString,
  scope: Schema.Literal("production"),
  action: ResourceMutationAction,
  resources: ProjectResourcePlan,
  inventory: Schema.Array(StoredProjectResource),
  operationRunId: Schema.NullOr(Schema.String),
  expiresAt: Schema.Number,
})
export type ResourceMutationReview = typeof ResourceMutationReview.Type
export const ResourceMutationConfirmation = Schema.Struct({
  projectId: Schema.NonEmptyString,
  reviewId: Schema.NonEmptyString,
  confirmation: Schema.NonEmptyString,
})
