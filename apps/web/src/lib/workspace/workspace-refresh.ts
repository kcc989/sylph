import type { WorkspaceRefreshScope } from "@workspace/domain"
export {
  workspaceEventRefreshScope as workspaceRefreshScope,
  type WorkspaceRefreshScope,
} from "@workspace/domain"

export const mergeWorkspaceRefreshScope = (
  left: WorkspaceRefreshScope | null,
  right: WorkspaceRefreshScope
): WorkspaceRefreshScope =>
  left === null || left === right ? right : "workspace"

export const createWorkspaceRefreshQueue = (
  refresh: (scope: WorkspaceRefreshScope) => Promise<void>,
  debounceMs = 0
) => {
  let pending: WorkspaceRefreshScope | null = null
  let active: Promise<void> | null = null
  return (scope: WorkspaceRefreshScope) => {
    pending = mergeWorkspaceRefreshScope(pending, scope)
    if (!active) {
      active = Promise.resolve().then(async () => {
        try {
          if (debounceMs > 0)
            await new Promise((resolve) => setTimeout(resolve, debounceMs))
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
