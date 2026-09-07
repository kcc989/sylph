import { env } from "cloudflare:workers"
import { schema } from "@workspace/db"
import { WorkspaceId } from "@workspace/domain"
import { drizzle } from "drizzle-orm/d1"
import { and, asc, eq, isNull } from "drizzle-orm"
import {
  scheduleWorkspaceMessageDelivery,
  scheduleWorkspaceProvisioning,
} from "./workspace-runtime"

export const recoverWorkspaceJobs = async () => {
  const database = drizzle(env.DB, { schema })
  const workspaces = await database
    .select({ id: schema.workspace.id })
    .from(schema.workspace)
    .where(
      and(
        eq(schema.workspace.status, "provisioning"),
        isNull(schema.workspace.provisioningScheduledAt)
      )
    )
    .orderBy(asc(schema.workspace.createdAt))
    .limit(25)
    .all()
  const messages = await database
    .select({
      id: schema.workspacePendingPrompt.id,
      workspaceId: schema.workspacePendingPrompt.workspaceId,
    })
    .from(schema.workspacePendingPrompt)
    .where(
      and(
        isNull(schema.workspacePendingPrompt.deliveredAt),
        isNull(schema.workspacePendingPrompt.scheduledAt)
      )
    )
    .orderBy(asc(schema.workspacePendingPrompt.sequence))
    .limit(25)
    .all()
  const results = await Promise.allSettled([
    ...workspaces.map((workspace) =>
      scheduleWorkspaceProvisioning(workspace.id)
    ),
    ...messages.map((message) =>
      scheduleWorkspaceMessageDelivery({
        workspaceId: WorkspaceId.make(message.workspaceId),
        messageId: message.id,
      })
    ),
  ])
  const failed = results.filter((result) => result.status === "rejected").length
  if (failed)
    throw new Error(`Could not schedule ${failed} background workspace jobs`)
}
