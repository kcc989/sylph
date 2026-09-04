"use client"

import {
  Archive,
  ChevronRight,
  Files,
  GitBranch,
  GitCompareArrows,
  GitMerge,
  LoaderCircle,
  MoreHorizontal,
  PanelLeftOpen,
  RefreshCw,
  Terminal,
  Trash2,
} from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"
import { useOptionalShell } from "../shell"
import type { BrowserState, CheckItem, WorkspacePresenceUser } from "./types"
import { useWorkspaceShellStore } from "./workspace-shell-provider"
import { openWorkspaceTool } from "./workspace-shell-store"

export function WorkspaceTopbar({
  agentControllingBrowser,
  browser,
  checks,
  projectName,
  repositoryName,
  workspaceName,
  onCheckpoint,
  checkpointDisabled,
  checkpointPending,
  onAccept,
  acceptDisabled,
  acceptPending,
  acceptBlockers = [],
  onRestartWorkspace,
  restartPending,
  onArchiveWorkspace,
  archivePending,
  onDiscardWorkspace,
  discardPending,
  onRebase,
  rebasePending,
  presence = [],
}: {
  agentControllingBrowser: boolean
  browser: BrowserState
  checks: CheckItem[]
  projectName: string
  repositoryName: string
  workspaceName: string
  onCheckpoint?: () => Promise<void>
  checkpointDisabled: boolean
  checkpointPending: boolean
  onAccept?: () => Promise<void>
  acceptDisabled: boolean
  acceptPending: boolean
  acceptBlockers?: ReadonlyArray<string>
  onRestartWorkspace?: () => Promise<void>
  restartPending: boolean
  onArchiveWorkspace?: () => Promise<void>
  archivePending: boolean
  onDiscardWorkspace?: () => Promise<void>
  discardPending: boolean
  onRebase?: () => Promise<void>
  rebasePending: boolean
  presence?: ReadonlyArray<WorkspacePresenceUser>
}) {
  const shell = useOptionalShell()
  const store = useWorkspaceShellStore()
  const navigationCollapsed = shell?.navigationCollapsed ?? true
  const passedChecks = checks.filter(
    (check) => check.status === "passed"
  ).length

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 overflow-hidden border-b bg-background px-3">
      <Button
        className={cn(navigationCollapsed ? "md:inline-flex" : "md:hidden")}
        aria-label={
          navigationCollapsed ? "Expand project navigation" : "Open navigation"
        }
        size="icon-sm"
        variant="ghost"
        onClick={() => shell?.openNavigation()}
      >
        {navigationCollapsed ? <PanelLeftOpen /> : <Files />}
      </Button>
      <span className="hidden max-w-36 min-w-0 shrink truncate text-xs whitespace-nowrap text-muted-foreground sm:inline">
        {projectName}
      </span>
      <ChevronRight className="hidden size-3 text-muted-foreground/50 sm:block" />
      <span className="max-w-32 min-w-0 shrink truncate text-xs font-medium whitespace-nowrap">
        {workspaceName}
      </span>
      <span className="hidden max-w-40 min-w-0 shrink truncate font-mono text-[9px] whitespace-nowrap text-muted-foreground 2xl:inline">
        {repositoryName}
      </span>
      {browser.status === "live" && (
        <Badge
          className="hidden rounded-[5px] border-white/10 bg-white/[.045] px-1.5 text-[10px] font-normal text-muted-foreground sm:inline-flex"
          variant="outline"
        >
          <span className="size-1.5 rounded-full bg-[var(--sylph-live)]" /> Live
        </Badge>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        {presence.length ? (
          <div aria-label="Workspace presence" className="mr-1 flex -space-x-1">
            {presence.slice(0, 4).map((user) => (
              <Avatar
                className="size-6 border-2 border-background"
                key={user.userId}
                size="sm"
                title={`${user.name}${user.connections > 1 ? ` · ${user.connections} tabs` : ""}`}
              >
                <AvatarFallback className="text-[8px]">
                  {user.name
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((part) => part[0])
                    .join("")
                    .toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ))}
          </div>
        ) : null}
        <div className="mr-1 hidden items-center gap-2 2xl:flex">
          <span className="text-[10px] text-muted-foreground">
            {checks.length > 0
              ? `Browser checks ${passedChecks}/${checks.length}`
              : "No browser checks"}
          </span>
          {browser.status === "live" && (
            <span className="size-1.5 rounded-full bg-[var(--sylph-live)]" />
          )}
          {agentControllingBrowser && (
            <span className="text-[10px] text-muted-foreground">
              Agent controlling browser
            </span>
          )}
        </div>
        <Button
          aria-label="Terminal"
          size="sm"
          variant="ghost"
          onClick={() => openWorkspaceTool(store, "terminal")}
        >
          <Terminal /> <span className="hidden lg:inline">Terminal</span>
        </Button>
        <Button
          aria-label="Checkpoint"
          size="sm"
          variant="outline"
          disabled={checkpointDisabled || checkpointPending}
          onClick={() => void onCheckpoint?.()}
        >
          {checkpointPending ? (
            <LoaderCircle className="animate-spin motion-reduce:animate-none" />
          ) : (
            <GitBranch />
          )}
          <span className="hidden xl:inline">Checkpoint</span>
        </Button>
        <Button
          aria-label="Accept"
          title={acceptBlockers.join(" ") || undefined}
          aria-description={acceptBlockers.join(" ") || undefined}
          size="sm"
          disabled={acceptDisabled || acceptPending}
          onClick={() => void onAccept?.()}
        >
          {acceptPending ? (
            <LoaderCircle className="animate-spin motion-reduce:animate-none" />
          ) : (
            <GitMerge />
          )}
          <span className="hidden xl:inline">Accept</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="More workspace actions"
            className="grid size-8 shrink-0 place-items-center rounded-[6px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              disabled={!onRebase || rebasePending}
              onClick={() => void onRebase?.()}
            >
              {rebasePending ? (
                <LoaderCircle className="animate-spin motion-reduce:animate-none" />
              ) : (
                <GitCompareArrows />
              )}
              Rebase Workspace
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!onRestartWorkspace || restartPending}
              onClick={() => void onRestartWorkspace?.()}
            >
              {restartPending ? (
                <LoaderCircle className="animate-spin motion-reduce:animate-none" />
              ) : (
                <RefreshCw />
              )}
              Restart runtime
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!onArchiveWorkspace || archivePending}
              onClick={() => void onArchiveWorkspace?.()}
            >
              {archivePending ? (
                <LoaderCircle className="animate-spin motion-reduce:animate-none" />
              ) : (
                <Archive />
              )}
              Archive Workspace
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              disabled={!onDiscardWorkspace || discardPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Discard ${workspaceName}? Its fork, Working copy, and Conversation will be permanently removed.`
                  )
                ) {
                  void onDiscardWorkspace?.()
                }
              }}
            >
              {discardPending ? (
                <LoaderCircle className="animate-spin motion-reduce:animate-none" />
              ) : (
                <Trash2 />
              )}
              Discard Workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
