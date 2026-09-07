import { schema } from "@workspace/db"
import {
  PreconditionFailed,
  WorkspaceId,
  WorkspaceProvisioningInput,
  WorkspaceRestartRequest,
  type RestartWorkspaceInput,
} from "@workspace/domain"
import { and, eq, isNull, sql } from "drizzle-orm"
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core"
import { Schema } from "effect"

type Database = BaseSQLiteDatabase<"async", unknown, typeof schema>

export const provisioningRequestMatches = (input: WorkspaceProvisioningInput) =>
  and(
    eq(schema.workspace.id, input.workspaceId),
    input.restart
      ? sql`json_extract(${schema.workspace.restartRequest}, '$.idempotencyKey') = ${input.restart.idempotencyKey}`
      : isNull(schema.workspace.restartRequest)
  )

export const activeProvisioningRequest = (input: WorkspaceProvisioningInput) =>
  and(
    provisioningRequestMatches(input),
    eq(schema.workspace.status, "provisioning")
  )

export const readProvisioningWorkspace = (
  database: Database,
  input: WorkspaceProvisioningInput
) =>
  database
    .select()
    .from(schema.workspace)
    .where(activeProvisioningRequest(input))
    .get()

export const workspaceProvisioningInput = (workspace: {
  id: string
  restartRequest: typeof WorkspaceRestartRequest.Encoded | null
}) =>
  new WorkspaceProvisioningInput({
    workspaceId: WorkspaceId.make(workspace.id),
    restart: workspace.restartRequest
      ? Schema.decodeUnknownSync(WorkspaceRestartRequest)(
          workspace.restartRequest
        )
      : undefined,
  })

export const workspaceProvisioningId = (input: WorkspaceProvisioningInput) =>
  input.restart
    ? `restart-${input.workspaceId}-${input.restart.idempotencyKey}`
    : `provision-${input.workspaceId}`

export const requestWorkspaceRestart = async (
  database: Database,
  input: RestartWorkspaceInput
) => {
  const workspace = await database
    .select()
    .from(schema.workspace)
    .where(eq(schema.workspace.id, input.workspaceId))
    .get()
  if (!workspace)
    throw new PreconditionFailed({ message: "Workspace no longer exists" })
  const restart = new WorkspaceRestartRequest({
    idempotencyKey: input.idempotencyKey,
    model: input.model,
  })
  const encoded = Schema.encodeSync(WorkspaceRestartRequest)(restart)
  if (workspace.restartRequest?.idempotencyKey === input.idempotencyKey) {
    if (JSON.stringify(workspace.restartRequest) !== JSON.stringify(encoded))
      throw new PreconditionFailed({
        message: "This restart request was already used with another model",
      })
    return workspace
  }
  if (workspace.status === "provisioning" || workspace.status === "merging")
    throw new PreconditionFailed({
      message:
        "Wait for the current Workspace operation to finish before restarting",
    })
  const updated = await database
    .update(schema.workspace)
    .set({
      restartRequest: encoded,
      provisioningScheduledAt: null,
      status: "provisioning",
      archivedAt:
        workspace.status === "archived"
          ? (workspace.archivedAt ?? new Date())
          : workspace.archivedAt,
      errorSummary: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        provisioningRequestMatches(workspaceProvisioningInput(workspace)),
        eq(schema.workspace.status, workspace.status)
      )
    )
    .returning()
    .get()
  if (!updated)
    throw new PreconditionFailed({
      message: "Workspace changed before restart; reload and try again",
    })
  return updated
}
