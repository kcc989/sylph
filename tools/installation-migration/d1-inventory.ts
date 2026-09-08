import {
  EarlierInstallationCommit,
  type InstallationMigrationInventory,
} from "@workspace/domain/installation-migration"
import { migrationDigest } from "./workspace-storage"

const quoted = (value: string) => `"${value.replaceAll('"', '""')}"`
export async function inventoryInstallation(
  database: D1Database,
  databaseId: string,
  namespaceId: string
): Promise<InstallationMigrationInventory> {
  const tables = await database
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_cf_KV','_cf_METADATA') ORDER BY name"
    )
    .all<{ name: string }>()
  const evidence: InstallationMigrationInventory["tables"][number][] = []
  for (const { name } of tables.results) {
    const columnRows = await database
      .prepare(`PRAGMA table_info(${quoted(name)})`)
      .all<{ name: string }>()
    const columns = columnRows.results.map((column) => column.name)
    const expressions = columns.flatMap((column, index) => [
      `typeof(${quoted(column)}) AS k${index}`,
      `CASE WHEN typeof(${quoted(column)}) IN ('text','blob') THEN hex(${quoted(column)}) ELSE quote(${quoted(column)}) END AS v${index}`,
    ])
    const result = await database
      .prepare(`SELECT ${expressions.join(",")} FROM ${quoted(name)}`)
      .all()
    const rows = result.results
      .map((row) =>
        columns.map((column, index) => ({
          kind: row[`k${index}`],
          value: row[`v${index}`],
        }))
      )
      .sort((left, right) =>
        JSON.stringify(left) < JSON.stringify(right)
          ? -1
          : JSON.stringify(left) > JSON.stringify(right)
            ? 1
            : 0
      )
    evidence.push({
      table: name,
      columns,
      rows: rows.length,
      sha256: await migrationDigest(rows),
    })
  }
  const schema = await database
    .prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name NOT IN ('d1_migrations','__alchemy_migrations','_cf_KV','_cf_METADATA') ORDER BY type,name"
    )
    .all()
  const schemaHash = await migrationDigest(
    schema.results.map((row) => [row.type, row.name, row.tbl_name, row.sql])
  )
  const workspaces = await database
    .prepare("SELECT id FROM workspace ORDER BY id")
    .all<{ id: string }>()
  return {
    sourceCommit: EarlierInstallationCommit,
    schemaHash,
    databaseId,
    namespaceId,
    workspaceIds: workspaces.results.map((row) => row.id),
    bookkeeping: evidence.filter((row) =>
      ["__alchemy_migrations", "d1_migrations"].includes(row.table)
    ),
    tables: evidence.filter(
      (row) => !["__alchemy_migrations", "d1_migrations"].includes(row.table)
    ),
  }
}
