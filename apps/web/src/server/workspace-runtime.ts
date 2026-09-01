import { schema } from "@workspace/db"
import {
  encodeInitializeWorkspaceRuntimeSync,
  failureMessage,
  WorkspaceRuntimeFailure,
  type InitializeWorkspaceRuntime,
} from "@workspace/domain"
import { env } from "cloudflare:workers"
import { eq } from "drizzle-orm"

import type { Database } from "@/server/organization-access"

export const workspaceRuntime = (name: string) =>
  env.WORKSPACES.get(env.WORKSPACES.idFromName(name))

export type WorkspaceRuntimeStub = ReturnType<typeof workspaceRuntime>

export const runtimeCall = async <Value>(
  call: () => Promise<Value>
): Promise<Value> => {
  try {
    return await call()
  } catch (cause) {
    throw new WorkspaceRuntimeFailure({
      message: failureMessage(cause, "Workspace runtime failed"),
    })
  }
}

export const initializeWorkspaceRuntime = (
  workspaceId: string,
  input: InitializeWorkspaceRuntime
) =>
  runtimeCall(() =>
    workspaceRuntime(workspaceId).initialize(
      encodeInitializeWorkspaceRuntimeSync(input)
    )
  )

export const completeWorkspaceInitialization = async (
  database: Database,
  workspaceId: string,
  input: InitializeWorkspaceRuntime
) => {
  try {
    await initializeWorkspaceRuntime(workspaceId, input)
    await database
      .update(schema.workspace)
      .set({
        status: "ready",
        syncStatus: "ready",
        errorSummary: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.workspace.id, workspaceId))
  } catch (cause) {
    await database
      .update(schema.workspace)
      .set({
        status: "error",
        errorSummary: failureMessage(cause, "Workspace runtime failed"),
        updatedAt: new Date(),
      })
      .where(eq(schema.workspace.id, workspaceId))
  }
}
