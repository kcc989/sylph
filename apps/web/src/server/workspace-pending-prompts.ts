import { schema } from "@workspace/db"
import {
  PreconditionFailed,
  WorkspacePromptInput,
  WorkspaceQueuedMessage,
  WorkspaceId,
} from "@workspace/domain"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import { Schema } from "effect"
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core"
type Database = BaseSQLiteDatabase<"async", unknown, typeof schema>
import { maxQueuedMessages } from "./workspace-provisioning-state"

export const pendingWorkspacePrompts = (
  database: Database,
  workspaceId: string
) =>
  database
    .select()
    .from(schema.workspacePendingPrompt)
    .where(
      and(
        eq(schema.workspacePendingPrompt.workspaceId, workspaceId),
        isNull(schema.workspacePendingPrompt.deliveredAt)
      )
    )
    .orderBy(asc(schema.workspacePendingPrompt.sequence))
    .all()

export const pendingPromptMessages = async (
  database: Database,
  workspaceId: string
) =>
  Promise.all(
    (await pendingWorkspacePrompts(database, workspaceId)).map(async (row) => {
      const payload = await Schema.decodeUnknownPromise(WorkspacePromptInput)(
        row.payload
      )
      const message = new WorkspaceQueuedMessage({
        id: row.id,
        text: payload.text,
        createdAt: row.createdAt,
        delivery: "queue",
      })
      return row.errorSummary
        ? new WorkspaceQueuedMessage({ ...message, error: row.errorSummary })
        : message
    })
  )

export const savePendingWorkspacePrompt = async (
  database: Database,
  userId: string,
  input: WorkspacePromptInput
) => {
  const id = input.messageId ?? crypto.randomUUID()
  const payload = await Schema.encodePromise(WorkspacePromptInput)(input)
  await database.run(sql`INSERT INTO workspace_pending_prompt (id, workspace_id, user_id, payload, created_at)
    SELECT ${id}, ${input.workspaceId}, ${userId}, ${JSON.stringify(payload)}, ${Date.now()}
    WHERE (SELECT count(*) FROM workspace_pending_prompt WHERE workspace_id = ${input.workspaceId} AND delivered_at IS NULL) < ${maxQueuedMessages}
    ON CONFLICT(id) DO NOTHING`)
  const saved = await database
    .select()
    .from(schema.workspacePendingPrompt)
    .where(eq(schema.workspacePendingPrompt.id, id))
    .get()
  if (!saved)
    throw new PreconditionFailed({
      message: `This Conversation already has ${maxQueuedMessages} queued messages`,
    })
  if (
    saved.workspaceId !== input.workspaceId ||
    saved.userId !== userId ||
    JSON.stringify(saved.payload) !== JSON.stringify(payload)
  )
    throw new PreconditionFailed({
      message: "This message ID has already been used for another message",
    })
  return { workspaceId: WorkspaceId.make(input.workspaceId), messageId: id }
}

export const dispatchPendingWorkspacePrompt = async (
  database: Database,
  input: { workspaceId: string; messageId: string },
  send: (
    row: typeof schema.workspacePendingPrompt.$inferSelect
  ) => Promise<void | "waiting">
) => {
  const row = await database
    .select()
    .from(schema.workspacePendingPrompt)
    .where(
      and(
        eq(schema.workspacePendingPrompt.id, input.messageId),
        eq(schema.workspacePendingPrompt.workspaceId, input.workspaceId)
      )
    )
    .get()
  if (!row || row.deliveredAt !== null) return "done"
  const workspace = await database
    .select()
    .from(schema.workspace)
    .where(eq(schema.workspace.id, input.workspaceId))
    .get()
  if (!workspace || workspace.status === "archived") return "done"
  if (
    workspace.status === "provisioning" ||
    workspace.status === "error" ||
    workspace.status === "merging"
  )
    return "waiting"
  const pending = await pendingWorkspacePrompts(database, input.workspaceId)
  if (pending[0]?.id !== input.messageId) return "waiting"
  if ((await send(row)) === "waiting") return "waiting"
  await database
    .update(schema.workspacePendingPrompt)
    .set({ deliveredAt: Date.now(), errorSummary: null })
    .where(eq(schema.workspacePendingPrompt.id, row.id))
  return "done"
}
