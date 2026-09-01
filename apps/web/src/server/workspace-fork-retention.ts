export interface WorkspaceRetentionInput {
  workspaceId: string
  workspaceRepositoryName: string
  archivedAt: number
}

export type RetainedWorkspaceRow = {
  status: string
  archivedAt: number | null
  forkDeletedAt: number | null
}

export const workspaceForkRetention = (configuredSeconds?: string) => {
  if (!configuredSeconds) return "7 days" as const
  const seconds = Number(configuredSeconds)
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error(
      "Workspace fork retention seconds must be a non-negative number"
    )
  }
  return seconds
}

export const workspaceRetentionInstanceId = (input: WorkspaceRetentionInput) =>
  `retention-${input.workspaceId}-${input.archivedAt}`

export const forkRetentionExpired = (
  input: WorkspaceRetentionInput,
  row: RetainedWorkspaceRow | null
) =>
  row !== null &&
  row.status === "archived" &&
  row.forkDeletedAt === null &&
  row.archivedAt === input.archivedAt

export const retainedWorkspaceSql =
  "SELECT status, archived_at AS archivedAt, fork_deleted_at AS forkDeletedAt FROM workspace WHERE id = ?"

export const forkDeletedSql =
  "UPDATE workspace SET fork_deleted_at = unixepoch(), updated_at = unixepoch() WHERE id = ?"
