import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto"
import { spawnSync } from "node:child_process"
import { Schema } from "effect"
import {
  EncryptedInstallationPreservation,
  InstallationPreservation,
  InstallationPreservationSource,
  PreservedDatabaseSummary,
} from "@workspace/domain/installation-preservation"

export const preservationHash = (value: string) =>
  createHash("sha256").update(value).digest("hex")

export function inspectPreservedSql(sql: string, target?: string) {
  const result = spawnSync(
    "python3",
    [new URL("preserve-sqlite.py", import.meta.url).pathname],
    {
      input: JSON.stringify({ sql, target }),
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      timeout: 120_000,
    }
  )
  if (result.status !== 0)
    throw new Error(
      "Installation SQL verification failed; no remote data was changed"
    )
  return Schema.decodeUnknownSync(PreservedDatabaseSummary)(
    JSON.parse(result.stdout)
  )
}

export function requirePreservedIdentity(
  source: InstallationPreservationSource,
  summary: PreservedDatabaseSummary
) {
  if (
    source.installationId !== summary.installation.id ||
    source.claimedByUserId !== summary.installation.claimed_by_user_id
  )
    throw new Error(
      "Installation identity does not match the preservation source"
    )
}

export function verifyPreservedCredentials(
  database: PreservedDatabaseSummary,
  secret: string
) {
  const key = createHash("sha256").update(secret).digest()
  for (const row of database.credentials) {
    const bytes = Buffer.from(row.encrypted, "base64")
    const decrypt = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(row.iv, "base64")
    )
    decrypt.setAuthTag(bytes.subarray(-16))
    try {
      decrypt.update(bytes.subarray(0, -16))
      decrypt.final()
    } catch {
      throw new Error(
        "CREDENTIAL_ENCRYPTION_KEY cannot decrypt preserved credentials"
      )
    }
  }
  return database.credentials.length
}

function archiveKey(key: Buffer) {
  if (key.length !== 32)
    throw new Error("The archive key file must contain exactly 32 random bytes")
  return key
}

export function sealInstallation(value: InstallationPreservation, key: Buffer) {
  const decoded = Schema.decodeUnknownSync(InstallationPreservation)(value)
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", archiveKey(key), iv)
  cipher.setAAD(Buffer.from("sylph-installation-preservation-v1"))
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(decoded)),
    cipher.final(),
  ])
  return {
    version: 1,
    algorithm: "AES-256-GCM",
    iv: Buffer.from(iv).toString("base64"),
    tag: Buffer.from(cipher.getAuthTag()).toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  }
}

export function openInstallation(
  encoded: string,
  key: Buffer,
  expected: InstallationPreservationSource
) {
  const envelope = Schema.decodeUnknownSync(EncryptedInstallationPreservation)(
    JSON.parse(encoded)
  )
  const decipher = createDecipheriv(
    "aes-256-gcm",
    archiveKey(key),
    Buffer.from(envelope.iv, "base64")
  )
  decipher.setAAD(Buffer.from("sylph-installation-preservation-v1"))
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ])
  const value = Schema.decodeUnknownSync(InstallationPreservation)(
    JSON.parse(plaintext.toString())
  )
  if (
    JSON.stringify(value.source) !==
    JSON.stringify(
      Schema.decodeUnknownSync(InstallationPreservationSource)(expected)
    )
  )
    throw new Error(
      "Archive source identity does not match the requested Installation"
    )
  if (preservationHash(value.sql) !== value.sqlHash)
    throw new Error("Preserved SQL digest differs")
  const database = inspectPreservedSql(value.sql)
  requirePreservedIdentity(value.source, database)
  if (
    database.schemaHash !== value.database.schemaHash ||
    database.dataHash !== value.database.dataHash
  )
    throw new Error("Preserved database schema or data differs")
  if (
    verifyPreservedCredentials(database, value.keys.credentialEncryptionKey) !==
    value.credentialRowsVerified
  )
    throw new Error("Preserved credential verification count differs")
  return value
}
