import { Schema } from "effect"

export const ProjectResourceKind = Schema.Literals([
  "worker",
  "d1",
  "kv",
  "r2",
  "queue",
  "domain",
])
export type ProjectResourceKind = typeof ProjectResourceKind.Type

export const PlannedProjectResource = Schema.Struct({
  kind: ProjectResourceKind,
  name: Schema.NonEmptyString,
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
  state: Schema.Literals(["reserved", "active", "deleted"]),
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
export const CloudflareWorkerBindings = Schema.Struct({
  bindings: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      name: Schema.String,
      id: Schema.optional(Schema.String),
      namespace_id: Schema.optional(Schema.String),
      bucket_name: Schema.optional(Schema.String),
      queue_name: Schema.optional(Schema.String),
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
})
export const ProjectResourceMaintenance = Schema.Struct({
  projectId: Schema.NonEmptyString,
  scope: Schema.NonEmptyString,
  runId: Schema.NonEmptyString,
  accountId: Schema.NonEmptyString,
  action: Schema.Literals(["inspect", "cleanup"]),
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
