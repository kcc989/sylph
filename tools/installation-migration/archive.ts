import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { execFileSync } from "node:child_process"
import { Schema } from "effect"
import {
  InstallationMigrationD1Import,
  WorkspaceMigrationEnvelope,
  InstallationMigrationArchive,
  InstallationMigrationConversion,
  InstallationMigrationInventory,
  type InstallationMigrationManifest,
} from "@workspace/domain/installation-migration"
import {
  EncryptedInstallationPreservation,
  type InstallationPreservationSource,
} from "@workspace/domain/installation-preservation"
import {
  openInstallation,
  preservationHash,
} from "../release-smoke/preservation"
import { validateWorkspaceEnvelope } from "./workspace-storage"

const aad = Buffer.from("sylph-installation-migration-v1")
const equal = <Left, Right>(left: Left, right: Right) =>
  JSON.stringify(left) === JSON.stringify(right)
export function convertInstallation(
  preservedSource: string,
  key: Buffer,
  expected: InstallationPreservationSource,
  workspaceIds: readonly string[]
) {
  const source = openInstallation(preservedSource, key, expected)
  const output = execFileSync(
    "python3",
    [new URL("./convert.py", import.meta.url).pathname],
    {
      input: JSON.stringify({
        sourceCommit: expected.sourceCommit,
        sql: source.sql,
        installationId: expected.installationId,
        claimedByUserId: expected.claimedByUserId,
        workspaceIds,
      }),
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      timeout: 120000,
      stdio: ["pipe", "pipe", "pipe"],
    }
  )
  return Schema.decodeUnknownSync(InstallationMigrationConversion)(
    JSON.parse(output)
  )
}

export function sealMigration(
  value: InstallationMigrationArchive,
  key: Buffer
) {
  if (key.byteLength !== 32)
    throw new Error("Migration archive key must contain 32 bytes")
  const decoded = Schema.decodeUnknownSync(InstallationMigrationArchive)(value)
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  cipher.setAAD(aad)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(decoded)),
    cipher.final(),
  ])
  return JSON.stringify({
    version: 1,
    algorithm: "AES-256-GCM",
    iv: Buffer.from(iv).toString("base64"),
    tag: Buffer.from(cipher.getAuthTag()).toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  })
}

export async function validateMigration(
  value: InstallationMigrationArchive,
  key: Buffer,
  expected: InstallationPreservationSource
) {
  const archive = Schema.decodeUnknownSync(InstallationMigrationArchive)(value)
  const manifest = archive.manifest
  if (
    manifest.installationId !== expected.installationId ||
    manifest.sourceDatabaseId !== expected.databaseId ||
    manifest.sourceCommit !== expected.sourceCommit
  )
    throw new Error("Migration source identity mismatch")
  const converted = convertInstallation(
    archive.preservedSource,
    key,
    expected,
    manifest.workspaceIds
  )
  if (
    !equal(converted, archive.conversion) ||
    manifest.sourceSqlHash !== converted.sourceSqlHash ||
    manifest.targetSqlHash !== converted.targetSqlHash ||
    preservationHash(converted.targetSql) !== converted.targetSqlHash
  )
    throw new Error("Independent D1 conversion differs")
  const source = openInstallation(archive.preservedSource, key, expected)
  if (
    !source.bindings.some(
      (binding) =>
        binding.type === "durable_object_namespace" &&
        binding.name === "WORKSPACES" &&
        binding.resourceId === manifest.sourceNamespaceId
    )
  )
    throw new Error(
      "Workspace namespace is absent from preserved source bindings"
    )
  if (
    archive.inventory.databaseId !== manifest.sourceDatabaseId ||
    archive.inventory.namespaceId !== manifest.sourceNamespaceId ||
    archive.inventory.schemaHash !== converted.sourceSchemaHash ||
    !equal(archive.inventory.bookkeeping, converted.sourceBookkeeping) ||
    !equal(archive.inventory.tables, converted.tables) ||
    !equal(archive.inventory.workspaceIds, manifest.workspaceIds)
  )
    throw new Error("Source database changed since preservation")
  if (
    !equal(
      manifest.workspaces
        .map((workspace) => workspace.snapshot.workspaceId)
        .sort(),
      [...manifest.workspaceIds].sort()
    ) ||
    new Set(manifest.workspaceIds).size !== manifest.workspaceIds.length
  )
    throw new Error("Incomplete or duplicate Workspace manifest")
  for (const workspace of manifest.workspaces) {
    await validateWorkspaceEnvelope(workspace, workspace.snapshot.workspaceId)
    const identity = converted.workspaceIdentities.find(
      (row) => row.id === workspace.snapshot.workspaceId
    )
    const state = workspace.snapshot.tables.find(
      (table) => table.name === "app_workspace_state"
    )
    const sessions = workspace.snapshot.tables.find(
      (table) => table.name === "session_v2"
    )
    const text = (table: typeof state, row: number, column: string) => {
      const value = table?.rows[row]?.[table.columns.indexOf(column)]
      return value?.kind === "text"
        ? Buffer.from(value.value, "hex").toString("utf8")
        : null
    }
    if (
      !identity ||
      state?.rows.length !== 1 ||
      text(state, 0, "workspace_id") !== identity.id ||
      text(state, 0, "organization_id") !== identity.organizationId ||
      text(state, 0, "project_id") !== identity.projectId ||
      identity.sessionIds.some(
        (id) =>
          !sessions?.rows.some(
            (row, index) => text(sessions, index, "id") === id
          )
      )
    )
      throw new Error(
        "Workspace identity or Conversation coverage differs from authoritative D1"
      )
  }
  return archive
}

export async function openMigration(
  encoded: string,
  key: Buffer,
  expected: InstallationPreservationSource
) {
  const envelope = Schema.decodeUnknownSync(EncryptedInstallationPreservation)(
    JSON.parse(encoded)
  )
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64")
  )
  decipher.setAAD(aad)
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ])
  return validateMigration(JSON.parse(plaintext.toString()), key, expected)
}

export function migrationBridge(url: string, token: string) {
  const base = new URL(url)
  if (base.protocol !== "https:" || base.username || base.password || !token)
    throw new Error("A dedicated HTTPS migration bridge and token are required")
  const request = async (
    path: string,
    value?:
      | InstallationMigrationManifest["workspaces"][number]
      | typeof InstallationMigrationD1Import.Type
  ) => {
    const response = await fetch(new URL(path, base.origin), {
      method: value ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: value ? JSON.stringify(value) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    })
    if (!response.ok)
      throw new Error(
        `Migration bridge rejected request (${response.status}); no automatic replay`
      )
    return response.json()
  }
  return {
    importDatabase: (value: typeof InstallationMigrationD1Import.Type) =>
      request("/__sylph/installation-migration/database", value),
    inventory: async () =>
      Schema.decodeUnknownSync(InstallationMigrationInventory)(
        await request("/__sylph/installation-migration/inventory")
      ),
    export: async (workspaceId: string) =>
      Schema.decodeUnknownSync(WorkspaceMigrationEnvelope)(
        await request(
          `/__sylph/installation-migration?workspaceId=${encodeURIComponent(workspaceId)}`
        )
      ),
    import: (workspace: InstallationMigrationManifest["workspaces"][number]) =>
      request(
        `/__sylph/installation-migration?workspaceId=${encodeURIComponent(workspace.snapshot.workspaceId)}`,
        workspace
      ),
  }
}
