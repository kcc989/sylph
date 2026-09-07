export type WorkspaceRefreshScope = "checks" | "runtime" | "workspace"

const eventScopes = new Map<string, WorkspaceRefreshScope | null>([
  ["form.cancelled", "runtime"],
  ["form.created", "runtime"],
  ["form.replied", "runtime"],
  ["permission.asked", null],
  ["permission.replied", null],
  ["session.execution.started", "runtime"],
  ["session.execution.failed", "workspace"],
  ["session.execution.interrupted", "workspace"],
  ["session.execution.succeeded", "workspace"],
  ["session.idle", "workspace"],
  ["session.inbox.cancelled", "runtime"],
  ["session.inbox.delivered", "runtime"],
  ["session.inbox.delivery.changed", "runtime"],
  ["session.inbox.enqueued", "runtime"],
  ["session.text.delta", null],
  ["session.text.ended", null],
  ["session.tool.called", "runtime"],
  ["session.tool.failed", "workspace"],
  ["session.tool.success", "workspace"],
])

export const isWorkspaceSessionEvent = (type: string) => eventScopes.has(type)

export const workspaceEventRefreshScope = (
  type: string
): WorkspaceRefreshScope | null => {
  if (type === "workspace.check.updated") return "checks"
  if (type === "workspace.event.truncated") return "workspace"
  return eventScopes.get(type) ?? null
}
