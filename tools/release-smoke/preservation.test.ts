import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createCipheriv, createHash, randomBytes } from "node:crypto"
import type { InstallationPreservation } from "@workspace/domain/installation-preservation"
import {
  inspectPreservedSql,
  openInstallation,
  preservationHash,
  requirePreservedIdentity,
  sealInstallation,
  verifyPreservedCredentials,
} from "./preservation"

const source = {
  accountId: "account",
  stage: "old-installation",
  sourceCommit: "a".repeat(40),
  websiteWorker: "old-website",
  runtimeWorkers: ["old-runtime"],
  databaseId: "old-d1",
  installationId: "default",
  claimedByUserId: "owner",
}
const secret = "old-credential-key-retained-for-transition"
const iv = Buffer.alloc(12, 7)
const cipher = createCipheriv(
  "aes-256-gcm",
  createHash("sha256").update(secret).digest(),
  iv
)
const encrypted = Buffer.concat([
  cipher.update("provider-secret"),
  cipher.final(),
  cipher.getAuthTag(),
]).toString("base64")
const sql = `CREATE TABLE installation (id TEXT PRIMARY KEY, claimed_by_user_id TEXT); INSERT INTO installation VALUES ('default', 'owner'); CREATE TABLE credentials (encrypted TEXT, iv TEXT); INSERT INTO credentials VALUES ('${encrypted}', '${iv.toString("base64")}'); CREATE TABLE old_workspace (id TEXT, content BLOB); INSERT INTO old_workspace VALUES ('workspace-1', X'00ff01');`

function archive(): InstallationPreservation {
  const database = inspectPreservedSql(sql)
  return {
    version: 1,
    scope: "d1-and-key-preservation-with-retained-runtime",
    createdAt: "2026-09-07T00:00:00.000Z",
    source,
    bindings: [],
    workerVersions: [],
    sql,
    sqlHash: preservationHash(sql),
    database,
    keys: {
      credentialEncryptionKey: secret,
      betterAuthSecret: "old-auth-secret",
    },
    credentialRowsVerified: 1,
    retainedState: "original-workers-and-namespaces-required",
  }
}

test("an encrypted earlier Installation imports into a new local database with binary data and old credentials intact", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sylph-preserve-"))
  try {
    const key = randomBytes(32)
    const encoded = JSON.stringify(sealInstallation(archive(), key))
    expect(encoded).not.toContain(secret)
    expect(encoded).not.toContain("provider-secret")
    const opened = openInstallation(encoded, key, source)
    expect(opened.credentialRowsVerified).toBe(1)
    const target = join(directory, "old.sqlite")
    inspectPreservedSql(opened.sql, target)
    using database = new Database(target, { readonly: true })
    expect(
      database
        .query("SELECT id, hex(content) AS content FROM old_workspace")
        .all()
    ).toEqual([{ id: "workspace-1", content: "00FF01" }])
    const before = await readFile(target)
    expect(() => inspectPreservedSql(opened.sql, target)).toThrow()
    expect(await readFile(target)).toEqual(before)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("wrong keys, changed archive bytes and a different Installation fail before import", () => {
  const key = randomBytes(32)
  const sealed = sealInstallation(archive(), key)
  expect(() =>
    openInstallation(JSON.stringify(sealed), randomBytes(32), source)
  ).toThrow()
  expect(() =>
    openInstallation(
      JSON.stringify({
        ...sealed,
        ciphertext: Buffer.alloc(32).toString("base64"),
      }),
      key,
      source
    )
  ).toThrow()
  expect(() =>
    openInstallation(JSON.stringify(sealed), key, {
      ...source,
      databaseId: "another-d1",
    })
  ).toThrow("identity")
  expect(() =>
    verifyPreservedCredentials(archive().database, "rotated-key")
  ).toThrow("cannot decrypt")
  expect(() =>
    requirePreservedIdentity(
      { ...source, claimedByUserId: "someone-else" },
      archive().database
    )
  ).toThrow("identity")
})

test("SQLite preservation rejects external file access and orphaned relational data", () => {
  expect(() =>
    inspectPreservedSql(
      `${sql} ATTACH DATABASE '/tmp/sylph-forbidden.db' AS external;`
    )
  ).toThrow()
  expect(() =>
    inspectPreservedSql(`${sql} SELECT load_extension('anything');`)
  ).toThrow()
  expect(() =>
    inspectPreservedSql(
      `${sql} CREATE TABLE child (parent TEXT REFERENCES installation(id)); INSERT INTO child VALUES ('missing');`
    )
  ).toThrow()
})
