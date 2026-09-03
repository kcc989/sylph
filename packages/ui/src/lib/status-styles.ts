import type { IssueStatus, WorkspaceStatus } from "@workspace/domain"

export const workspaceStatusStyles = {
  provisioning: "text-amber-400",
  ready: "text-muted-foreground",
  running: "text-[var(--sylph-live)]",
  waiting: "text-amber-400",
  idle: "text-muted-foreground",
  interrupted: "text-amber-400",
  merging: "text-primary",
  archived: "text-muted-foreground/50",
  error: "text-destructive",
} satisfies Record<WorkspaceStatus, string>

export const issueStatusStyles = {
  open: "text-muted-foreground",
  closed: "text-muted-foreground/50",
} satisfies Record<IssueStatus, string>
