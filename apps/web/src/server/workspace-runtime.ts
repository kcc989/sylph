import { schema } from "@workspace/db"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import {
  WorkspaceId,
  type WorkspaceMessageDeliveryInput,
} from "@workspace/domain"
import { deploymentWorkflowAlreadyStarted } from "./deployment-records"
import { env } from "cloudflare:workers"
import {
  makeWorkspaceRuntime,
  type WorkspaceRuntime,
} from "@/server/workspace-runtime-client"

export type { WorkspaceRuntime } from "@/server/workspace-runtime-client"

export const workspaceRuntime = (name: string): WorkspaceRuntime =>
  makeWorkspaceRuntime(env.WORKSPACES.get(env.WORKSPACES.idFromName(name)))

export const scheduleWorkspaceProvisioning = async (workspaceId: string) => {
  try {
    await env.PROVISIONING.create({
      id: `provision-${workspaceId}`,
      params: { workspaceId: WorkspaceId.make(workspaceId) },
    })
  } catch (cause) {
    if (!deploymentWorkflowAlreadyStarted(cause)) throw cause
  }
  await drizzle(env.DB)
    .update(schema.workspace)
    .set({ provisioningScheduledAt: Date.now() })
    .where(eq(schema.workspace.id, workspaceId))
}

export const scheduleWorkspaceMessageDelivery = async (
  input: typeof WorkspaceMessageDeliveryInput.Encoded
) => {
  try {
    await env.MESSAGE_DELIVERY.create({
      id: `message-${input.messageId}`,
      params: input,
    })
  } catch (cause) {
    if (!deploymentWorkflowAlreadyStarted(cause)) throw cause
  }
  await drizzle(env.DB)
    .update(schema.workspacePendingPrompt)
    .set({ scheduledAt: Date.now() })
    .where(eq(schema.workspacePendingPrompt.id, input.messageId))
}
