import { Schema } from "effect"
import { ProjectResourceOperation } from "@workspace/domain/project-resources"
import type { ResourceDatabase } from "./project-resources"

interface CleanupWorkflow {
  status(): Promise<{ status: string }>
  terminate(): Promise<void>
}

export const stopPreviewRetention = async (
  operation: ProjectResourceOperation,
  confirmation: { scope: string; runId: string },
  workflow: CleanupWorkflow
) => {
  if (
    !operation.scope.startsWith("preview:") ||
    confirmation.scope !== operation.scope ||
    confirmation.runId !== operation.run_id ||
    !["retained", "cleanup_failed"].includes(operation.status)
  )
    throw new Error("Confirm the current retained Preview or failed cleanup")
  const observed = await workflow.status()
  const terminal = ["errored", "terminated", "complete"]
  if (operation.status === "retained" && observed.status === "waiting") {
    await workflow.terminate()
    const stopped = await workflow.status()
    if (!terminal.includes(stopped.status))
      throw new Error(
        "Preview retention is still stopping. Refresh and try again."
      )
    return stopped.status
  }
  if (!terminal.includes(observed.status))
    throw new Error(
      "Deployment or automatic cleanup is still running. Wait for it to stop."
    )
  return observed.status
}

export const readCleanupOperation = async (
  database: ResourceDatabase,
  projectId: string,
  scope: string
) =>
  Schema.decodeUnknownSync(ProjectResourceOperation)(
    await database
      .prepare(
        "SELECT * FROM project_resource_operation WHERE project_id = ? AND scope = ?"
      )
      .bind(projectId, scope)
      .first()
  )

export const requestPreviewCleanup = async (
  database: ResourceDatabase,
  input: {
    projectId: string
    scope: string
    confirmedScope?: string
    confirmedRunId?: string
    requestId?: string
  },
  actorId: string,
  workflows: {
    ci: { get(id: string): Promise<CleanupWorkflow> }
    maintenance: {
      get(id: string): Promise<{ status(): Promise<{ status: string }> }>
      create(options: {
        id: string
        params: {
          projectId: string
          accountId: string
          scope: string
          runId: string
          action: "cleanup"
        }
      }): Promise<{ id: string }>
    }
  }
) => {
  if (
    !input.requestId ||
    !/^[a-f0-9-]{36}$/.test(input.requestId) ||
    !input.confirmedRunId ||
    input.confirmedScope !== input.scope
  )
    throw new Error(
      "Confirm this Preview and its current deployment before cleanup"
    )
  let requestId = input.requestId
  const operation = await readCleanupOperation(
    database,
    input.projectId,
    input.scope
  )
  if (
    !input.scope.startsWith("preview:") ||
    operation.run_id !== input.confirmedRunId ||
    !["retained", "cleanup_failed"].includes(operation.status)
  )
    throw new Error(
      "The Preview changed or cannot be cleaned up. Refresh before confirming."
    )
  const active = await database
    .prepare(
      "SELECT id, status, actor_id, run_id FROM project_preview_cleanup_request WHERE project_id = ? AND account_id = ? AND scope = ? AND status IN ('preparing', 'dispatched')"
    )
    .bind(input.projectId, operation.account_id, input.scope)
    .first<{ id: string; status: string; actor_id: string; run_id: string }>()
  if (active && active.id !== requestId) {
    if (active.status === "preparing") {
      if (active.actor_id !== actorId || active.run_id !== operation.run_id)
        throw new Error("Another Admin is preparing this Preview cleanup")
      requestId = active.id
    } else {
      const previous = await workflows.maintenance.get(active.id)
      const status = await previous.status()
      if (!["complete", "errored", "terminated"].includes(status.status))
        throw new Error(
          "Preview cleanup is still running. Wait for its retries to finish."
        )
      await database
        .prepare(
          "UPDATE project_preview_cleanup_request SET status = ?, updated_at = unixepoch() WHERE id = ? AND status = 'dispatched'"
        )
        .bind(status.status === "complete" ? "completed" : "failed", active.id)
        .run()
    }
  }
  await database
    .prepare(
      "INSERT INTO project_preview_cleanup_request (id, project_id, account_id, scope, run_id, actor_id, confirmed_scope, previous_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING"
    )
    .bind(
      requestId,
      input.projectId,
      operation.account_id,
      input.scope,
      operation.run_id,
      actorId,
      input.scope,
      operation.status
    )
    .run()
  const saved = await database
    .prepare(
      "SELECT id FROM project_preview_cleanup_request WHERE id = ? AND project_id = ? AND account_id = ? AND scope = ? AND run_id = ? AND actor_id = ? AND status IN ('preparing', 'dispatched')"
    )
    .bind(
      requestId,
      input.projectId,
      operation.account_id,
      input.scope,
      operation.run_id,
      actorId
    )
    .first()
  if (!saved)
    throw new Error("Cleanup confirmation does not match this request")
  try {
    const current = await readCleanupOperation(
      database,
      input.projectId,
      input.scope
    )
    if (
      current.account_id !== operation.account_id ||
      current.run_id !== operation.run_id ||
      current.status !== operation.status
    )
      throw new Error("The Preview changed. Refresh before confirming cleanup.")
    const workflow = await workflows.ci.get(operation.run_id)
    const terminalStatus = await stopPreviewRetention(
      current,
      { scope: input.scope, runId: input.confirmedRunId },
      workflow
    )
    await database
      .prepare(
        "UPDATE project_preview_cleanup_request SET terminal_status = ?, updated_at = unixepoch() WHERE id = ?"
      )
      .bind(terminalStatus, requestId)
      .run()
    const beforeDispatch = await readCleanupOperation(
      database,
      input.projectId,
      input.scope
    )
    if (
      beforeDispatch.account_id !== operation.account_id ||
      beforeDispatch.run_id !== operation.run_id ||
      beforeDispatch.status !== operation.status
    )
      throw new Error(
        "The Preview changed after stopping retention. Refresh before cleanup."
      )
  } catch (cause) {
    await database
      .prepare(
        "UPDATE project_preview_cleanup_request SET status = 'failed', updated_at = unixepoch() WHERE id = ? AND status = 'preparing'"
      )
      .bind(requestId)
      .run()
    throw cause
  }
  try {
    await workflows.maintenance.create({
      id: requestId,
      params: {
        projectId: input.projectId,
        accountId: operation.account_id,
        scope: input.scope,
        runId: operation.run_id,
        action: "cleanup",
      },
    })
  } catch (cause) {
    const existing = await workflows.maintenance.get(requestId)
    const status = await existing.status()
    if (["errored", "terminated"].includes(status.status)) {
      await database
        .prepare(
          "UPDATE project_preview_cleanup_request SET status = 'failed', updated_at = unixepoch() WHERE id = ? AND status = 'preparing'"
        )
        .bind(requestId)
        .run()
      throw cause
    }
    if (
      !["queued", "running", "waiting", "paused", "complete"].includes(
        status.status
      )
    )
      throw cause
  }
  await database
    .prepare(
      "UPDATE project_preview_cleanup_request SET status = 'dispatched', updated_at = unixepoch() WHERE id = ? AND status = 'preparing'"
    )
    .bind(requestId)
    .run()
  return { workflowId: requestId }
}
