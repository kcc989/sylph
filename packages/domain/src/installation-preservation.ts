import { Schema } from "effect"

const Commit = Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/))
const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))
const ResourceId = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_-]+$/))

export const PreservationConfiguration = Schema.Struct({
  CLOUDFLARE_ACCOUNT_ID: Schema.NonEmptyString,
  CLOUDFLARE_API_TOKEN: Schema.NonEmptyString,
  CREDENTIAL_ENCRYPTION_KEY: Schema.NonEmptyString,
  BETTER_AUTH_SECRET: Schema.NonEmptyString,
})

export const InstallationPreservationSource = Schema.Struct({
  accountId: ResourceId,
  stage: ResourceId,
  sourceCommit: Commit,
  websiteWorker: ResourceId,
  runtimeWorkers: Schema.Array(ResourceId),
  databaseId: ResourceId,
  installationId: Schema.NonEmptyString,
  claimedByUserId: Schema.NullOr(Schema.String),
})
export type InstallationPreservationSource =
  typeof InstallationPreservationSource.Type

export const PreservedBinding = Schema.Struct({
  worker: ResourceId,
  name: Schema.String,
  type: Schema.String,
  resourceId: Schema.NullOr(Schema.String),
})

export const PreservedWorkerVersion = Schema.Struct({
  worker: ResourceId,
  versions: Schema.Array(
    Schema.Struct({ version_id: Schema.String, percentage: Schema.Number })
  ),
})

export const PreservedDatabaseSummary = Schema.Struct({
  schemaHash: Digest,
  dataHash: Digest,
  tables: Schema.Array(
    Schema.Struct({ name: Schema.String, rows: Schema.Int, digest: Digest })
  ),
  installation: Schema.Struct({
    id: Schema.String,
    claimed_by_user_id: Schema.NullOr(Schema.String),
  }),
  credentials: Schema.Array(
    Schema.Struct({
      table: Schema.String,
      encrypted: Schema.String,
      iv: Schema.String,
    })
  ),
})
export type PreservedDatabaseSummary = typeof PreservedDatabaseSummary.Type

export const InstallationPreservation = Schema.Struct({
  version: Schema.Literal(1),
  scope: Schema.Literal("d1-and-key-preservation-with-retained-runtime"),
  createdAt: Schema.String,
  source: InstallationPreservationSource,
  bindings: Schema.Array(PreservedBinding),
  workerVersions: Schema.Array(PreservedWorkerVersion),
  sql: Schema.String,
  sqlHash: Digest,
  database: PreservedDatabaseSummary,
  keys: Schema.Struct({
    credentialEncryptionKey: Schema.NonEmptyString,
    betterAuthSecret: Schema.NonEmptyString,
  }),
  credentialRowsVerified: Schema.Int,
  retainedState: Schema.Literal("original-workers-and-namespaces-required"),
})
export type InstallationPreservation = typeof InstallationPreservation.Type

export const EncryptedInstallationPreservation = Schema.Struct({
  version: Schema.Literal(1),
  algorithm: Schema.Literal("AES-256-GCM"),
  iv: Schema.String,
  tag: Schema.String,
  ciphertext: Schema.String,
})

export const PreservationWorkerSettings = Schema.Struct({
  bindings: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      type: Schema.String,
      id: Schema.optional(Schema.String),
      namespace_id: Schema.optional(Schema.String),
      bucket_name: Schema.optional(Schema.String),
      database_id: Schema.optional(Schema.String),
      script_name: Schema.optional(Schema.String),
    })
  ),
})

export const PreservationWorkerSettingsResponse = Schema.Struct({
  success: Schema.Boolean,
  result: PreservationWorkerSettings,
})
export const PreservationWorkerDeployments = Schema.Struct({
  success: Schema.Boolean,
  result: Schema.Struct({
    deployments: Schema.Array(
      Schema.Struct({
        versions: Schema.Array(
          Schema.Struct({
            version_id: Schema.String,
            percentage: Schema.Number,
          })
        ),
      })
    ),
  }),
})

export const PreservationD1Export = Schema.Struct({
  success: Schema.Boolean,
  result: Schema.Struct({
    status: Schema.optional(Schema.String),
    at_bookmark: Schema.optional(Schema.String),
    result: Schema.optional(Schema.Struct({ signed_url: Schema.String })),
  }),
})
