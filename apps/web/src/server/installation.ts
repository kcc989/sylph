import { schema } from "@workspace/db"
import { env } from "cloudflare:workers"

import type { Database } from "@/server/organization-access"

export const installationId = "default"
export const installationOrganizationId = "installation-organization"

export const secretsMatch = async (provided: string, expected: string) => {
  const encoder = new TextEncoder()
  const [providedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ])
  const left = new Uint8Array(providedDigest)
  const right = new Uint8Array(expectedDigest)
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index]
  }
  return difference === 0
}

export const ensureInstallationOwner = async (
  database: Database,
  organizationId: string,
  userId: string,
  sessionId: string
) => {
  await database
    .insert(schema.member)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      userId,
      role: "owner",
    })
    .onConflictDoUpdate({
      target: [schema.member.organizationId, schema.member.userId],
      set: { role: "owner" },
    })
  await env.DB.prepare(
    "UPDATE session SET active_organization_id = ? WHERE id = ?"
  )
    .bind(organizationId, sessionId)
    .run()
}
