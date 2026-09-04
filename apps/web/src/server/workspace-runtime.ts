import { WorkspaceId } from "@workspace/domain"
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
}
