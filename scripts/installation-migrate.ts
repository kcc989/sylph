import { readFile, stat, writeFile } from "node:fs/promises"
import { parseArgs } from "node:util"
import { Schema } from "effect"
import {
  EarlierInstallationCommit,
  type InstallationMigrationArchive,
} from "@workspace/domain/installation-migration"
import { InstallationPreservationSource } from "@workspace/domain/installation-preservation"
import {
  convertInstallation,
  migrationBridge,
  openMigration,
  sealMigration,
  validateMigration,
} from "../tools/installation-migration/archive"
import { validateWorkspaceEnvelope } from "../tools/installation-migration/workspace-storage"

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    source: { type: "string" },
    preservation: { type: "string" },
    archive: { type: "string" },
    "key-file": { type: "string" },
    bridge: { type: "string" },
    "target-database-id": { type: "string" },
    "target-namespace-id": { type: "string" },
  },
})
async function main() {
  const command = positionals[0]
  if (
    !values.source ||
    !values.archive ||
    !values["key-file"] ||
    ![
      "capture",
      "verify",
      "import-d1",
      "import-workspaces",
      "verify-target",
    ].includes(command ?? "")
  )
    throw new Error(
      "Use capture|verify|import-d1|import-workspaces|verify-target --source source.json --archive encrypted.json --key-file archive.key; capture requires --preservation encrypted-preservation.json --bridge https://source; target commands require --bridge https://target --target-database-id ID --target-namespace-id ID"
    )
  const source = Schema.decodeUnknownSync(InstallationPreservationSource)(
    JSON.parse(await readFile(values.source, "utf8"))
  )
  const keyStat = await stat(values["key-file"])
  if ((keyStat.mode & 0o077) !== 0)
    throw new Error("Archive key permissions must be private")
  const key = await readFile(values["key-file"])
  if (command === "capture") {
    if (!values.bridge || !values.preservation)
      throw new Error(
        "Capture requires source bridge and encrypted preservation archive"
      )
    const bridge = migrationBridge(
      values.bridge,
      process.env.SYLPH_INSTALLATION_MIGRATION_TOKEN ?? ""
    )
    const inventory = await bridge.inventory()
    const preservedSource = await readFile(values.preservation, "utf8")
    const conversion = convertInstallation(
      preservedSource,
      key,
      source,
      inventory.workspaceIds
    )
    const workspaces = []
    for (const workspaceId of inventory.workspaceIds)
      workspaces.push(
        await validateWorkspaceEnvelope(
          await bridge.export(workspaceId),
          workspaceId
        )
      )
    if (JSON.stringify(await bridge.inventory()) !== JSON.stringify(inventory))
      throw new Error("Source Installation changed during capture")
    const archive: InstallationMigrationArchive = {
      preservedSource,
      conversion,
      inventory,
      manifest: {
        version: 1,
        sourceCommit: EarlierInstallationCommit,
        installationId: source.installationId,
        sourceDatabaseId: source.databaseId,
        sourceNamespaceId: inventory.namespaceId,
        sourceSqlHash: conversion.sourceSqlHash,
        targetSqlHash: conversion.targetSqlHash,
        workspaceIds: inventory.workspaceIds,
        workspaces,
      },
    }
    await validateMigration(archive, key, source)
    await writeFile(values.archive, sealMigration(archive, key), {
      flag: "wx",
      mode: 0o600,
    })
    console.log(
      `Captured encrypted Installation migration: ${workspaces.length} Workspaces; source retained`
    )
    return
  }
  const archive = await openMigration(
    await readFile(values.archive, "utf8"),
    key,
    source
  )
  if (command === "verify") {
    console.log(
      `Verified encrypted migration: ${archive.manifest.workspaceIds.length} Workspaces`
    )
    return
  }
  if (
    !values.bridge ||
    !values["target-database-id"] ||
    !values["target-namespace-id"]
  )
    throw new Error("Target identity and HTTPS bridge are required")
  if (
    values["target-database-id"] === source.databaseId ||
    values["target-namespace-id"] === archive.manifest.sourceNamespaceId
  )
    throw new Error("Target must use a new database and Workspace namespace")
  const bridge = migrationBridge(
    values.bridge,
    process.env.SYLPH_INSTALLATION_MIGRATION_TOKEN ?? ""
  )
  if (command === "import-d1") {
    await bridge.importDatabase({
      sourceDatabaseId: source.databaseId,
      targetDatabaseId: values["target-database-id"],
      sql: archive.conversion.targetSql,
      statements: archive.conversion.targetStatements,
      sha256: archive.conversion.targetSqlHash,
    })
  }
  const validateTarget = async () => {
    const inventory = await bridge.inventory()
    if (
      inventory.databaseId !== values["target-database-id"] ||
      inventory.namespaceId !== values["target-namespace-id"] ||
      inventory.schemaHash !== archive.conversion.targetSchemaHash ||
      JSON.stringify(inventory.bookkeeping) !==
        JSON.stringify(archive.conversion.targetBookkeeping) ||
      JSON.stringify(inventory.tables) !==
        JSON.stringify(archive.conversion.targetTables)
    )
      throw new Error(
        "Target database content or identity does not match independently converted source"
      )
  }
  await validateTarget()
  if (command === "import-d1") {
    console.log(
      "Independently verified converted target D1; Workspaces still require import and verification"
    )
    return
  }
  for (const workspace of archive.manifest.workspaces) {
    if (command === "import-workspaces") await bridge.import(workspace)
    const restored = await validateWorkspaceEnvelope(
      await bridge.export(workspace.snapshot.workspaceId),
      workspace.snapshot.workspaceId
    )
    if (JSON.stringify(restored) !== JSON.stringify(workspace))
      throw new Error("Target Workspace content differs; do not promote target")
  }
  await validateTarget()
  console.log(
    `Verified target contents: ${archive.manifest.workspaceIds.length} Workspaces; no source deletion or traffic cutover`
  )
}
main().catch(() => {
  console.error(
    "Installation migration rejected. No automatic replay or cutover; keep the retained source and inspect the target before retrying."
  )
  process.exitCode = 1
})
