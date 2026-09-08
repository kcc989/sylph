import { Schema } from "effect"

export const EarlierInstallationCommit =
  "5311a147464946a7f0b781737166ea81d9c91f78"
const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))
export const MigrationSqlCell = Schema.Struct({
  kind: Schema.Literals(["null", "integer", "real", "text", "blob"]),
  value: Schema.String,
})
export const MigrationSqlObject = Schema.Struct({
  type: Schema.Literals(["table", "index"]),
  name: Schema.NonEmptyString,
  table: Schema.NonEmptyString,
  sql: Schema.NonEmptyString,
})
export const MigrationSqlTable = Schema.Struct({
  name: Schema.NonEmptyString,
  columns: Schema.Array(Schema.NonEmptyString),
  rows: Schema.Array(Schema.Array(MigrationSqlCell)),
})
export const WorkspaceMigrationSnapshot = Schema.Struct({
  version: Schema.Literal(1),
  sourceCommit: Schema.Literal(EarlierInstallationCommit),
  workspaceId: Schema.NonEmptyString,
  schema: Schema.Array(MigrationSqlObject),
  tables: Schema.Array(MigrationSqlTable),
  kv: Schema.Array(
    Schema.Struct({ key: Schema.String, encoded: Schema.String })
  ),
  alarm: Schema.NullOr(Schema.Number),
})
export type WorkspaceMigrationSnapshot = typeof WorkspaceMigrationSnapshot.Type
export type MigrationSqlCell = typeof MigrationSqlCell.Type
export const WorkspaceMigrationEnvelope = Schema.Struct({
  snapshot: WorkspaceMigrationSnapshot,
  sha256: Digest,
})
export type WorkspaceMigrationEnvelope = typeof WorkspaceMigrationEnvelope.Type
export const InstallationMigrationManifest = Schema.Struct({
  version: Schema.Literal(1),
  sourceCommit: Schema.Literal(EarlierInstallationCommit),
  installationId: Schema.NonEmptyString,
  sourceDatabaseId: Schema.NonEmptyString,
  sourceNamespaceId: Schema.NonEmptyString,
  sourceSqlHash: Digest,
  targetSqlHash: Digest,
  workspaceIds: Schema.Array(Schema.NonEmptyString),
  workspaces: Schema.Array(WorkspaceMigrationEnvelope),
})
export type InstallationMigrationManifest =
  typeof InstallationMigrationManifest.Type
export class InstallationMigrationError extends Schema.TaggedError<InstallationMigrationError>()(
  "InstallationMigrationError",
  { message: Schema.String }
) {}

export const MigrationTableEvidence = Schema.Struct({
  table: Schema.NonEmptyString,
  columns: Schema.Array(Schema.String),
  rows: Schema.Int,
  sha256: Digest,
})
export const InstallationMigrationInventory = Schema.Struct({
  sourceCommit: Schema.Literal(EarlierInstallationCommit),
  databaseId: Schema.NonEmptyString,
  schemaHash: Digest,
  bookkeeping: Schema.Array(MigrationTableEvidence),
  namespaceId: Schema.NonEmptyString,
  workspaceIds: Schema.Array(Schema.NonEmptyString),
  tables: Schema.Array(MigrationTableEvidence),
})
export const InstallationMigrationConversion = Schema.Struct({
  sourceCommit: Schema.Literal(EarlierInstallationCommit),
  sourceSqlHash: Digest,
  targetSql: Schema.String,
  targetStatements: Schema.Array(Schema.String),
  targetSqlHash: Digest,
  sourceSchemaHash: Digest,
  targetSchemaHash: Digest,
  workspaceIds: Schema.Array(Schema.String),
  tables: Schema.Array(MigrationTableEvidence),
  targetTables: Schema.Array(MigrationTableEvidence),
  sourceBookkeeping: Schema.Array(MigrationTableEvidence),
  targetBookkeeping: Schema.Array(MigrationTableEvidence),
  workspaceIdentities: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      projectId: Schema.String,
      organizationId: Schema.String,
      sessionIds: Schema.Array(Schema.String),
    })
  ),
  targetMigrations: Schema.Array(
    Schema.Struct({ name: Schema.String, sha256: Digest })
  ),
})
export type InstallationMigrationConversion =
  typeof InstallationMigrationConversion.Type
export type InstallationMigrationInventory =
  typeof InstallationMigrationInventory.Type

export const InstallationMigrationArchive = Schema.Struct({
  manifest: InstallationMigrationManifest,
  inventory: InstallationMigrationInventory,
  conversion: InstallationMigrationConversion,
  preservedSource: Schema.String,
})
export type InstallationMigrationArchive =
  typeof InstallationMigrationArchive.Type

export type MigrationStoredValue =
  | undefined
  | null
  | string
  | boolean
  | number
  | bigint
  | Date
  | ArrayBuffer
  | Uint8Array
  | readonly MigrationStoredValue[]
  | ReadonlyMap<MigrationStoredValue, MigrationStoredValue>
  | ReadonlySet<MigrationStoredValue>
  | { readonly [key: string]: MigrationStoredValue }
export const MigrationStoredValue: Schema.Codec<MigrationStoredValue> =
  Schema.suspend(() =>
    Schema.Union([
      Schema.Undefined,
      Schema.Null,
      Schema.String,
      Schema.Boolean,
      Schema.Finite,
      Schema.BigInt,
      Schema.Date,
      Schema.instanceOf(ArrayBuffer),
      Schema.instanceOf(Uint8Array),
      Schema.Array(MigrationStoredValue),
      Schema.ReadonlyMap(MigrationStoredValue, MigrationStoredValue),
      Schema.ReadonlySet(MigrationStoredValue),
      Schema.Record(Schema.String, MigrationStoredValue),
    ])
  )

export const InstallationMigrationD1Import = Schema.Struct({
  sourceDatabaseId: Schema.NonEmptyString,
  targetDatabaseId: Schema.NonEmptyString,
  sql: Schema.NonEmptyString,
  statements: Schema.Array(Schema.NonEmptyString),
  sha256: Digest,
})
