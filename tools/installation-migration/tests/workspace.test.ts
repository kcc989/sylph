import { test, expect } from "bun:test"
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rolldown } from "rolldown"
import { Miniflare } from "miniflare"
import { Schema } from "effect"
import {
  InstallationMigrationInventory,
  type InstallationMigrationArchive,
} from "@workspace/domain/installation-migration"
import { installationFixture } from "./fixture"
import {
  convertInstallation,
  openMigration,
  sealMigration,
  validateMigration,
} from "../archive"
import {
  WorkspaceMigrationEnvelope,
  MigrationSqlObject,
} from "@workspace/domain/installation-migration"
import { migrationDigest } from "../workspace-storage"

test("copies actual Workerd SQLite and structured KV, rejects incomplete and active state", async () => {
  const fixture = installationFixture()
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "sylph-installation-migration-"))
  )
  const bundle = await rolldown({
    input: new URL("./worker.ts", import.meta.url).pathname,
    external: ["cloudflare:workers"],
  })
  await bundle.write({
    dir: directory,
    entryFileNames: "worker.mjs",
    format: "esm",
  })
  await bundle.close()
  const worker = new Miniflare({
    modules: true,
    modulesRoot: directory,
    scriptPath: join(directory, "worker.mjs"),
    compatibilityDate: "2026-08-01",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: {
      SOURCE: { className: "FixtureWorkspace", useSQLite: true },
      TARGET: { className: "TargetWorkspace", useSQLite: true },
    },
    d1Databases: { DB: "target-database", SOURCE_DB: "source-database" },
    bindings: {
      D1_STATEMENTS: fixture.statements,
      SOURCE_SQL: await readFile(
        new URL("../sources/workspace-5311a14.sql", import.meta.url),
        "utf8"
      ),
    },
  })
  const request = (path: string, value?: WorkspaceMigrationEnvelope) =>
    worker.dispatchFetch(
      `https://migration.test${path}`,
      value ? { method: "POST", body: JSON.stringify(value) } : {}
    )
  try {
    expect(await (await request("/seed")).text()).toBe("seeded")
    expect(
      Schema.decodeUnknownSync(Schema.Array(MigrationSqlObject))(
        await (await request("/schema")).json()
      )
    ).toEqual(
      JSON.parse(
        await readFile(
          new URL("../sources/workspace-schema.json", import.meta.url),
          "utf8"
        )
      )
    )
    const response = await request("/export")
    const exported = Schema.decodeUnknownSync(WorkspaceMigrationEnvelope)(
      await response.json()
    )
    const partialSnapshot = {
      ...exported.snapshot,
      tables: exported.snapshot.tables.slice(0, -1),
    }
    const incomplete = {
      snapshot: partialSnapshot,
      sha256: await migrationDigest(partialSnapshot),
    }
    expect((await request("/import?target=true", incomplete)).status).toBe(409)
    const tampered = {
      ...exported,
      snapshot: { ...exported.snapshot, workspaceId: "other-workspace" },
    }
    expect((await request("/import?target=true", tampered)).status).toBe(409)
    const duplicateTable = exported.snapshot.tables.find(
      (table) => table.name === "app_workspace_file"
    )
    if (!duplicateTable?.rows[0]) throw new Error("Fixture file row missing")
    const duplicateSnapshot = {
      ...exported.snapshot,
      tables: exported.snapshot.tables.map((table) =>
        table.name === duplicateTable.name
          ? { ...table, rows: [...table.rows, duplicateTable.rows[0]] }
          : table
      ),
    }
    expect(
      (
        await request("/import?target=true", {
          snapshot: duplicateSnapshot,
          sha256: await migrationDigest(duplicateSnapshot),
        })
      ).status
    ).toBe(409)
    const imported = await request("/import?target=true", exported)
    expect(await imported.json()).toEqual({
      workspaceId: "workspace-a",
      sha256: exported.sha256,
    })
    expect(await (await request("/export?target=true")).json()).toEqual(
      exported
    )
    expect(await (await request("/content?target=true")).json()).toEqual({
      files: [
        { path: "binary.dat", bytes: "000102FF" },
        { path: "text.txt", bytes: "610062F09F9880" },
      ],
      transcripts: [
        {
          data: JSON.stringify({ role: "user", content: "Keep my transcript" }),
        },
      ],
      forms: [{ data: '{"questions":["Choose a color"]}' }],
      inbox: [{ payload: '{"text":"waiting input"}' }],
      permissions: [{ action: "write", resource: "/workspace/*" }],
      sequence: [{ sequence: "9223372036854775806" }],
    })
    expect((await request("/import?target=true", exported)).status).toBe(409)
    expect(await (await request("/seed-d1")).text()).toBe("seeded")
    const inventoryResponse = await request("/source-inventory")
    const inventoryText = await inventoryResponse.text()
    expect(inventoryText).not.toContain("Error:")
    const inventory = Schema.decodeUnknownSync(InstallationMigrationInventory)(
      JSON.parse(inventoryText)
    )
    const conversion = convertInstallation(
      fixture.preservedSource,
      fixture.key,
      fixture.source,
      inventory.workspaceIds
    )
    const archive: InstallationMigrationArchive = {
      preservedSource: fixture.preservedSource,
      conversion,
      inventory,
      manifest: {
        version: 1,
        sourceCommit: inventory.sourceCommit,
        installationId: "default",
        sourceDatabaseId: "source-database",
        sourceNamespaceId: "source-namespace",
        sourceSqlHash: conversion.sourceSqlHash,
        targetSqlHash: conversion.targetSqlHash,
        workspaceIds: inventory.workspaceIds,
        workspaces: [exported],
      },
    }
    await validateMigration(archive, fixture.key, fixture.source)
    const sealed = sealMigration(archive, fixture.key)
    expect(sealed).not.toContain("fixture-project-secret")
    expect(await openMigration(sealed, fixture.key, fixture.source)).toEqual(
      archive
    )
    const missingWorkspace = {
      ...archive,
      manifest: { ...archive.manifest, workspaces: [] },
    }
    await expect(
      validateMigration(missingWorkspace, fixture.key, fixture.source)
    ).rejects.toThrow("Incomplete")
    const duplicateWorkspace = {
      ...archive,
      manifest: { ...archive.manifest, workspaces: [exported, exported] },
    }
    await expect(
      validateMigration(duplicateWorkspace, fixture.key, fixture.source)
    ).rejects.toThrow("Incomplete")
    const changedInventory = {
      ...archive,
      inventory: { ...archive.inventory, schemaHash: "0".repeat(64) },
    }
    await expect(
      validateMigration(changedInventory, fixture.key, fixture.source)
    ).rejects.toThrow("Source database changed")
    const wrongIdentitySnapshot = {
      ...exported.snapshot,
      tables: exported.snapshot.tables.map((table) =>
        table.name === "app_workspace_state"
          ? {
              ...table,
              rows: table.rows.map((row) =>
                row.map((cell, index) =>
                  table.columns[index] === "project_id"
                    ? {
                        ...cell,
                        value: Buffer.from("another-project")
                          .toString("hex")
                          .toUpperCase(),
                      }
                    : cell
                )
              ),
            }
          : table
      ),
    }
    const wrongIdentityArchive = {
      ...archive,
      manifest: {
        ...archive.manifest,
        workspaces: [
          {
            snapshot: wrongIdentitySnapshot,
            sha256: await migrationDigest(wrongIdentitySnapshot),
          },
        ],
      },
    }
    await expect(
      validateMigration(wrongIdentityArchive, fixture.key, fixture.source)
    ).rejects.toThrow("Workspace identity")
    const wrongKey = Buffer.alloc(32, 1)
    await expect(
      openMigration(sealed, wrongKey, fixture.source)
    ).rejects.toThrow()
    const altered = JSON.parse(sealed)
    altered.ciphertext = `AAAA${altered.ciphertext.slice(4)}`
    await expect(
      openMigration(JSON.stringify(altered), fixture.key, fixture.source)
    ).rejects.toThrow()
    const importDatabase = () =>
      worker.dispatchFetch(
        "https://migration.test/__sylph/installation-migration/database",
        {
          method: "POST",
          headers: { authorization: "Bearer fixture-token" },
          body: JSON.stringify({
            sourceDatabaseId: "source-database",
            targetDatabaseId: "target-database",
            sql: conversion.targetSql,
            statements: conversion.targetStatements,
            sha256: conversion.targetSqlHash,
          }),
        }
      )
    const databaseImport = await importDatabase()
    expect(await databaseImport.text()).toBe(
      JSON.stringify({
        databaseId: "target-database",
        sha256: conversion.targetSqlHash,
      })
    )
    const targetInventoryResponse = await worker.dispatchFetch(
      "https://migration.test/__sylph/installation-migration/inventory",
      { headers: { authorization: "Bearer fixture-token" } }
    )
    const targetInventory = Schema.decodeUnknownSync(
      InstallationMigrationInventory
    )(await targetInventoryResponse.json())
    expect(targetInventory.tables).toEqual(conversion.targetTables)
    expect(targetInventory.bookkeeping).toEqual(conversion.targetBookkeeping)
    expect(targetInventory.schemaHash).toBe(conversion.targetSchemaHash)
    expect((await importDatabase()).status).toBe(409)
    expect(
      (
        await worker.dispatchFetch(
          "https://migration.test/__sylph/installation-migration/inventory"
        )
      ).status
    ).toBe(401)
    expect((await request("/active")).status).toBe(409)
    expect((await request("/unknown?target=true")).status).toBe(409)
  } finally {
    await worker.dispose()
    await rm(directory, { recursive: true, force: true })
  }
}, 60000)
