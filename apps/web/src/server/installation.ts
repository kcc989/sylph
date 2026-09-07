import { schema } from "@workspace/db"
import { env } from "cloudflare:workers"

import type { Database } from "@/server/organization-access"

export const installationId = "default"
export const installationOrganizationId = "installation-organization"

export { secretsMatch } from "./secret-comparison"

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
