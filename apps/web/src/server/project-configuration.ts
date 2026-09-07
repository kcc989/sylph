import { ProjectDomain } from "@workspace/domain/project-resources"
import { Schema } from "effect"
import { decryptCredential, encryptCredential } from "./credentials.server"
import type { ResourceDatabase } from "./project-resources"

export const validateProjectSecretName = (name: string) => {
  if (
    !/^[A-Z][A-Z0-9_]{0,127}$/.test(name) ||
    /^(SYLPH_|CLOUDFLARE_|CF_|ALCHEMY_|BETTER_AUTH_SECRET$|DB$|ASSETS$|PATH$|HOME$|NODE_OPTIONS$|BUN_OPTIONS$)/.test(
      name
    )
  ) {
    throw new Error(
      "Use an uppercase application secret name. Deployment and authentication settings are reserved."
    )
  }
}

export const saveProjectSecret = async (
  database: ResourceDatabase,
  projectId: string,
  environment: string,
  name: string,
  value: string | null,
  key: string
) => {
  validateProjectSecretName(name)
  if (value === null) {
    await database
      .prepare(
        "DELETE FROM project_secret WHERE project_id = ? AND environment = ? AND name = ?"
      )
      .bind(projectId, environment, name)
      .run()
    return
  }
  if (!value || value.length > 16384)
    throw new Error("A secret must contain between 1 and 16384 characters")
  const encrypted = await encryptCredential(value, key)
  await database
    .prepare(
      "INSERT INTO project_secret (project_id, environment, name, encrypted, iv) VALUES (?, ?, ?, ?, ?) ON CONFLICT(project_id, environment, name) DO UPDATE SET encrypted = excluded.encrypted, iv = excluded.iv"
    )
    .bind(projectId, environment, name, encrypted.encrypted, encrypted.iv)
    .run()
}

export const projectSecretEnvironment = async (
  database: ResourceDatabase,
  projectId: string,
  environment: string,
  key: string
) => {
  const rows = await database
    .prepare(
      "SELECT name, encrypted, iv FROM project_secret WHERE project_id = ? AND environment = ?"
    )
    .bind(projectId, environment)
    .all<{ name: string; encrypted: string; iv: string }>()
  const secrets: Array<[string, string]> = []
  for (const row of rows.results) {
    validateProjectSecretName(row.name)
    secrets.push([
      row.name,
      await decryptCredential(row.encrypted, row.iv, key),
    ])
  }
  return { SYLPH_PROJECT_SECRETS: JSON.stringify(Object.fromEntries(secrets)) }
}

export const readProjectDomain = async (
  database: ResourceDatabase,
  projectId: string
) => {
  const row = await database
    .prepare(
      "SELECT hostname, zone_id FROM project_domain WHERE project_id = ?"
    )
    .bind(projectId)
    .first()
  return Schema.decodeUnknownSync(Schema.NullOr(ProjectDomain))(row)
}

export const saveProjectDomain = async (
  database: ResourceDatabase,
  projectId: string,
  hostname: string,
  zoneId: string
) => {
  const owned = await database
    .prepare(
      "SELECT name FROM project_resource WHERE project_id = ? AND kind = 'domain' AND state != 'deleted'"
    )
    .bind(projectId)
    .first<{ name: string }>()
  if (owned && owned.name !== hostname)
    throw new Error(
      "Retire the deployed custom domain before replacing or removing it"
    )
  if (!hostname && !zoneId) {
    await database
      .prepare("DELETE FROM project_domain WHERE project_id = ?")
      .bind(projectId)
      .run()
    return
  }
  if (
    hostname.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      hostname
    ) ||
    !/^[a-f0-9]{32}$/.test(zoneId)
  )
    throw new Error(
      "Enter a lowercase hostname and a 32-character Cloudflare zone ID"
    )
  await database
    .prepare(
      "INSERT INTO project_domain (project_id, hostname, zone_id) VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET hostname = excluded.hostname, zone_id = excluded.zone_id"
    )
    .bind(projectId, hostname, zoneId)
    .run()
}
