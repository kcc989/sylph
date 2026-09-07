import { schema } from "@workspace/db"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import {
  activeProvisioningRequest,
  workspaceProvisioningId,
  workspaceProvisioningInput,
} from "./workspace-provisioning-request"
import { type WorkspaceMessageDeliveryInput } from "@workspace/domain"
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
  const database = drizzle(env.DB, { schema })
  const workspace = await database
    .select()
    .from(schema.workspace)
    .where(eq(schema.workspace.id, workspaceId))
    .get()
  if (!workspace || workspace.status !== "provisioning") return
  const input = workspaceProvisioningInput(workspace)
  try {
    await env.PROVISIONING.create({
      id: workspaceProvisioningId(input),
      params: input,
    })
  } catch (cause) {
    if (!deploymentWorkflowAlreadyStarted(cause)) throw cause
  }
  await database
    .update(schema.workspace)
    .set({ provisioningScheduledAt: Date.now() })
    .where(activeProvisioningRequest(input))
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
