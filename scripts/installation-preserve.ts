import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { homedir } from "node:os"
import { parseArgs, parseEnv } from "node:util"
import { Schema } from "effect"
import {
  InstallationPreservationSource,
  PreservationConfiguration,
} from "@workspace/domain/installation-preservation"
import {
  inspectPreservedSql,
  openInstallation,
  preservationHash,
  requirePreservedIdentity,
  sealInstallation,
  verifyPreservedCredentials,
} from "../tools/release-smoke/preservation"
import {
  exportPreservedD1,
  inspectRetainedInstallation,
} from "../tools/release-smoke/preservation-cloudflare"

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    source: { type: "string" },
    archive: { type: "string" },
    "key-file": { type: "string" },
    target: { type: "string" },
  },
})

async function main() {
  const command = positionals[0]
  if (
    !["capture", "verify", "import-local", "verify-retained"].includes(
      command ?? ""
    ) ||
    !values.source ||
    !values.archive ||
    !values["key-file"]
  )
    throw new Error(
      "Use capture|verify|import-local|verify-retained --source source.json --archive /private/path/archive.json --key-file /private/path/archive.key; import-local also requires --target /new/path.sqlite"
    )
  const source = Schema.decodeUnknownSync(InstallationPreservationSource)(
    JSON.parse(await readFile(values.source, "utf8"))
  )
  const keyPath = resolve(values["key-file"])
  const keyStat = await stat(keyPath)
  if ((keyStat.mode & 0o077) !== 0)
    throw new Error(
      "Archive key file must not be accessible by group or other users"
    )
  const key = await readFile(keyPath)
  const archivePath = resolve(values.archive)
  if (command === "capture" || command === "verify-retained") {
    const configurationPath = resolve(
      process.env.SYLPH_SMOKE_ENV_FILE ||
        `${process.env.XDG_CONFIG_HOME || `${homedir()}/.config`}/sylph/release-smoke.env`
    )
    const saved = parseEnv(await readFile(configurationPath, "utf8"))
    const required = [
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_API_TOKEN",
      "CREDENTIAL_ENCRYPTION_KEY",
      "BETTER_AUTH_SECRET",
    ]
    const missing = required.filter((name) => !saved[name])
    if (missing.length) {
      console.error(`Missing in saved configuration: ${missing.join(", ")}`)
      throw new Error(`Missing in saved configuration: ${missing.join(", ")}`)
    }
    const configuration = Schema.decodeUnknownSync(PreservationConfiguration)(
      saved
    )
    const access = {
      accountId: configuration.CLOUDFLARE_ACCOUNT_ID,
      token: configuration.CLOUDFLARE_API_TOKEN,
    }
    const retained = await inspectRetainedInstallation(access, source)
    if (command === "verify-retained") {
      const archive = openInstallation(
        await readFile(archivePath, "utf8"),
        key,
        source
      )
      if (
        JSON.stringify(retained.bindings) !==
          JSON.stringify(archive.bindings) ||
        JSON.stringify(retained.workerVersions) !==
          JSON.stringify(archive.workerVersions)
      )
        throw new Error(
          "Retained Worker versions or bindings changed; inspect the old Installation before proceeding"
        )
      console.log(
        "Retained Worker versions and namespace bindings match. This does not inspect Durable Object contents."
      )
      return
    }
    const sql = await exportPreservedD1(access, source.databaseId)
    const database = inspectPreservedSql(sql)
    requirePreservedIdentity(source, database)
    const credentialRowsVerified = verifyPreservedCredentials(
      database,
      configuration.CREDENTIAL_ENCRYPTION_KEY
    )
    const sealed = sealInstallation(
      {
        version: 1,
        scope: "d1-and-key-preservation-with-retained-runtime",
        createdAt: new Date().toISOString(),
        source,
        ...retained,
        sql,
        sqlHash: preservationHash(sql),
        database,
        keys: {
          credentialEncryptionKey: configuration.CREDENTIAL_ENCRYPTION_KEY,
          betterAuthSecret: configuration.BETTER_AUTH_SECRET,
        },
        credentialRowsVerified,
        retainedState: "original-workers-and-namespaces-required",
      },
      key
    )
    await mkdir(dirname(archivePath), { recursive: true, mode: 0o700 })
    await writeFile(archivePath, JSON.stringify(sealed), {
      mode: 0o600,
      flag: "wx",
    })
  }
  const archive = openInstallation(
    await readFile(archivePath, "utf8"),
    key,
    source
  )
  if (command === "import-local") {
    if (!values.target)
      throw new Error("import-local requires a new --target SQLite file")
    inspectPreservedSql(archive.sql, resolve(values.target))
  }
  console.log(
    JSON.stringify(
      {
        scope: archive.scope,
        source: archive.source,
        schemaHash: archive.database.schemaHash,
        dataHash: archive.database.dataHash,
        tables: archive.database.tables,
        credentialRowsVerified: archive.credentialRowsVerified,
        credentialKeyContinuity: archive.credentialRowsVerified
          ? "verified-against-preserved-ciphertext"
          : "key-retained-but-no-ciphertext-to-verify",
        durableState: archive.retainedState,
        localImport: command === "import-local" ? "verified" : "not-requested",
        currentSchemaConversion: "not-performed",
        remoteWrites: "none",
      },
      null,
      2
    )
  )
}

main().catch(() => {
  console.error(
    "Installation preservation failed. Check source identity, private key permissions, saved configuration, Cloudflare access and archive integrity. No remote restore or deletion was attempted."
  )
  process.exitCode = 1
})
