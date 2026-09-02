import { schema } from "@workspace/db"
import {
  failureMessage,
  type InitializeWorkspaceRuntime,
} from "@workspace/domain"
import { env } from "cloudflare:workers"
import { eq } from "drizzle-orm"

import type { Database } from "@/server/organization-access"
import {
  makeWorkspaceRuntime,
  type WorkspaceRuntime,
} from "@/server/workspace-runtime-client"

export type { WorkspaceRuntime } from "@/server/workspace-runtime-client"

export const workspaceRuntime = (name: string): WorkspaceRuntime =>
  makeWorkspaceRuntime(env.WORKSPACES.get(env.WORKSPACES.idFromName(name)))

export const completeWorkspaceInitialization = async (
  database: Database,
  workspaceId: string,
  input: InitializeWorkspaceRuntime
) => {
  try {
    await workspaceRuntime(workspaceId).initialize(input)
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
