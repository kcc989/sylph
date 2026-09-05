export type WorkspaceRefreshScope = "checks" | "runtime" | "workspace"

export const mergeWorkspaceRefreshScope = (
  left: WorkspaceRefreshScope | null,
  right: WorkspaceRefreshScope
): WorkspaceRefreshScope =>
  left === null || left === right ? right : "workspace"

export const workspaceRefreshScope = (type: string): WorkspaceRefreshScope => {
  if (type === "workspace.check.updated") return "checks"
  if (
    type === "session.execution.started" ||
    type.startsWith("session.inbox.") ||
    type.startsWith("form.") ||
    type === "session.tool.called"
  )
    return "runtime"
  return "workspace"
}

export const createWorkspaceRefreshQueue = (
  refresh: (scope: WorkspaceRefreshScope) => Promise<void>
) => {
  let pending: WorkspaceRefreshScope | null = null
  let active: Promise<void> | null = null
  return (scope: WorkspaceRefreshScope) => {
    pending = mergeWorkspaceRefreshScope(pending, scope)
    if (!active) {
      active = Promise.resolve().then(async () => {
        try {
          while (pending) {
            const next = pending
            pending = null
            await refresh(next)
          }
        } finally {
          active = null
        }
      })
    }
    return active
  }
}
