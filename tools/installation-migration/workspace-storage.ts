import { Schema } from "effect"
import {
  EarlierInstallationCommit,
  InstallationMigrationError,
  WorkspaceMigrationEnvelope,
  type WorkspaceMigrationSnapshot,
  MigrationSqlCell,
  MigrationStoredValue,
} from "@workspace/domain/installation-migration"
import supportedMigrations from "./sources/workspace-migrations.json"
import supportedSchema from "./sources/workspace-schema.json"
import { decodeStoredValue, encodeStoredValue } from "./structured-value"

const fail = (message: string): never => {
  throw new InstallationMigrationError({ message })
}
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`
const compare = <Left, Right>(left: Left, right: Right) =>
  JSON.stringify(left) === JSON.stringify(right)
export async function migrationDigest<Value>(value: Value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const hash = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

function literal(cell: MigrationSqlCell): string {
  if (cell.kind === "null" && cell.value === "NULL") return "NULL"
  if (cell.kind === "integer" && /^-?\d+$/.test(cell.value)) return cell.value
  if (
    cell.kind === "real" &&
    /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(cell.value) &&
    Number.isFinite(Number(cell.value))
  )
    return cell.value
  if (
    (cell.kind === "text" || cell.kind === "blob") &&
    /^(?:[a-f0-9]{2})*$/i.test(cell.value)
  )
    return cell.kind === "text"
      ? `CAST(X'${cell.value}' AS TEXT)`
      : `X'${cell.value}'`
  return fail("Invalid SQL cell")
}

function assertIdle(storage: DurableObjectStorage) {
  const queries = [
    "SELECT 1 FROM session_v2 WHERE time_idle IS NULL OR time_suspended IS NOT NULL OR time_compacting IS NOT NULL LIMIT 1",
    "SELECT 1 FROM app_workspace_check_run WHERE status IN ('queued','running') LIMIT 1",
    "SELECT 1 FROM app_workspace_outbox WHERE completed_at IS NULL LIMIT 1",
    "SELECT 1 FROM app_workspace_check_completion WHERE delivered = 0 LIMIT 1",
  ]
  if (queries.some((query) => storage.sql.exec(query).toArray().length > 0))
    fail("Workspace has active or resumable operations")
}

export async function exportWorkspace(
  storage: DurableObjectStorage,
  workspaceId: string
): Promise<WorkspaceMigrationEnvelope> {
  const schema = storage.sql
    .exec(
      "SELECT type,name,tbl_name AS 'table',sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT IN ('__cf_kv','_cf_KV') ORDER BY type,name"
    )
    .toArray()
  if (!compare(schema, supportedSchema))
    fail("Unsupported Workspace SQLite schema")
  const identities = storage.sql
    .exec("SELECT workspace_id FROM app_workspace_state")
    .toArray()
  if (identities.length !== 1 || identities[0]?.workspace_id !== workspaceId)
    fail("Workspace identity mismatch")
  const migrations = storage.sql
    .exec<{ id: string }>("SELECT id FROM migration ORDER BY id")
    .toArray()
    .map((row) => row.id)
  if (!compare(migrations, supportedMigrations))
    fail("Unsupported SDK migration history")
  assertIdle(storage)
  if ((await storage.getAlarm()) !== null)
    fail("Workspace has a scheduled alarm")
  const tables: WorkspaceMigrationSnapshot["tables"][number][] = []
  const names = [
    ...supportedSchema
      .filter((entry) => entry.type === "table")
      .map((entry) => entry.name),
    "sqlite_sequence",
  ].sort()
  for (const name of names) {
    const columns = storage.sql
      .exec<{ name: string }>(`PRAGMA table_info(${quote(name)})`)
      .toArray()
      .map((column) => column.name)
    const selected =
      name === "sqlite_sequence" ? columns : ["rowid", ...columns]
    const expressions = selected.flatMap((column, index) => [
      `typeof(${quote(column)}) AS k${index}`,
      `CASE WHEN typeof(${quote(column)}) IN ('text','blob') THEN hex(${quote(column)}) ELSE quote(${quote(column)}) END AS v${index}`,
    ])
    const rows = storage.sql
      .exec(`SELECT ${expressions.join(",")} FROM ${quote(name)}`)
      .toArray()
      .map((row) =>
        selected.map((column, index) =>
          Schema.decodeUnknownSync(MigrationSqlCell)({
            kind: row[`k${index}`],
            value: row[`v${index}`],
          })
        )
      )
    rows.sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right))
    )
    tables.push({ name, columns: selected, rows })
  }
  const kv = Array.from(await storage.list(), ([key, value]) => ({
    key,
    encoded: encodeStoredValue(
      Schema.decodeUnknownSync(MigrationStoredValue)(value)
    ),
  })).sort((left, right) => left.key.localeCompare(right.key))
  const snapshot = Schema.decodeUnknownSync(
    WorkspaceMigrationEnvelope.fields.snapshot
  )({
    version: 1,
    sourceCommit: EarlierInstallationCommit,
    workspaceId,
    schema,
    tables,
    kv,
    alarm: await storage.getAlarm(),
  })
  if (JSON.stringify(snapshot).length > 32 * 1024 * 1024)
    fail("Workspace exceeds bounded migration size")
  return { snapshot, sha256: await migrationDigest(snapshot) }
}

export async function validateWorkspaceEnvelope(
  value: WorkspaceMigrationEnvelope,
  workspaceId: string
) {
  const envelope = Schema.decodeUnknownSync(WorkspaceMigrationEnvelope)(value)
  if (JSON.stringify(envelope.snapshot).length > 32 * 1024 * 1024)
    fail("Workspace exceeds bounded migration size")
  if (envelope.snapshot.alarm !== null)
    fail("Scheduled Workspace alarms require draining before migration")
  if (
    envelope.snapshot.workspaceId !== workspaceId ||
    envelope.sha256 !== (await migrationDigest(envelope.snapshot))
  )
    fail("Workspace manifest identity or hash mismatch")
  if (!compare(envelope.snapshot.schema, supportedSchema))
    fail("Unsupported Workspace SQLite schema")
  const tableNames = [
    ...supportedSchema
      .filter((entry) => entry.type === "table")
      .map((entry) => entry.name),
    "sqlite_sequence",
  ].sort()
  if (
    !compare(
      envelope.snapshot.tables.map((table) => table.name),
      tableNames
    )
  )
    fail("Incomplete or duplicate Workspace table inventory")
  if (
    new Set(envelope.snapshot.kv.map((entry) => entry.key)).size !==
    envelope.snapshot.kv.length
  )
    fail("Duplicate KV key")
  for (const table of envelope.snapshot.tables) {
    if (new Set(table.columns).size !== table.columns.length)
      fail("Duplicate SQL column")
    for (const row of table.rows) {
      if (row.length !== table.columns.length) fail("Partial SQL row")
      row.forEach(literal)
    }
  }
  envelope.snapshot.kv.forEach((entry) => decodeStoredValue(entry.encoded))
  return envelope
}

export async function importWorkspace(
  storage: DurableObjectStorage,
  workspaceId: string,
  value: WorkspaceMigrationEnvelope
) {
  const envelope = await validateWorkspaceEnvelope(value, workspaceId)
  if (
    storage.sql
      .exec(
        "SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT IN ('__cf_kv','_cf_KV')"
      )
      .toArray().length > 0 ||
    (await storage.list()).size > 0 ||
    (await storage.getAlarm()) !== null
  )
    fail("Target Workspace is not empty")
  storage.transactionSync(() => {
    storage.sql.exec("PRAGMA defer_foreign_keys=ON")
    for (const entry of envelope.snapshot.schema)
      if (entry.type === "table") storage.sql.exec(entry.sql)
    for (const table of envelope.snapshot.tables) {
      const columns = storage.sql
        .exec<{ name: string }>(`PRAGMA table_info(${quote(table.name)})`)
        .toArray()
        .map((column) => column.name)
      const expected =
        table.name === "sqlite_sequence" ? columns : ["rowid", ...columns]
      if (!compare(table.columns, expected)) fail("Unexpected SQL columns")
      if (table.name === "sqlite_sequence")
        storage.sql.exec("DELETE FROM sqlite_sequence")
      for (const row of table.rows)
        storage.sql.exec(
          `INSERT INTO ${quote(table.name)} (${table.columns.map(quote).join(",")}) VALUES (${row.map(literal).join(",")})`
        )
    }
    for (const entry of envelope.snapshot.schema)
      if (entry.type === "index") storage.sql.exec(entry.sql)
    if (storage.sql.exec("PRAGMA foreign_key_check").toArray().length > 0)
      fail("Workspace foreign key validation failed")
    assertIdle(storage)
    for (const entry of envelope.snapshot.kv)
      storage.kv.put(entry.key, decodeStoredValue(entry.encoded))
  })
  const restored = await exportWorkspace(storage, workspaceId)
  if (!compare(restored, envelope))
    fail("Independent restored Workspace content differs")
  return { workspaceId, sha256: restored.sha256 }
}
