"use client"

import {
  Archive,
  ChevronRight,
  Files,
  GitCompareArrows,
  LoaderCircle,
  MoreHorizontal,
  PanelLeftOpen,
  RefreshCw,
  Terminal,
  Trash2,
} from "lucide-react"

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
import {
  useWorkspaceShell,
  useWorkspaceShellStore,
} from "./workspace-shell-provider"
import {
  openWorkspaceTool,
  setWorkspaceToolPaneOpen,
} from "./workspace-shell-store"

export function WorkspaceTopbar({
  agentControllingBrowser,
  browser,
  checks,
  projectName,
  workspaceName,
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
  const paneOpen = useWorkspaceShell((state) => state.toolPaneOpen)
  const mobileView = useWorkspaceShell((state) => state.mobileView)

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
      {navigationCollapsed && projectName !== workspaceName ? (
        <>
          <span className="hidden max-w-36 min-w-0 truncate text-xs text-muted-foreground sm:inline">
            {projectName}
          </span>
          <ChevronRight className="hidden size-3 shrink-0 text-muted-foreground sm:block" />
        </>
      ) : null}
      <span
        title={workspaceName}
        className="min-w-0 flex-1 truncate text-sm font-medium"
      >
        {workspaceName}
      </span>
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
        <Button
          className="hidden md:inline-flex"
          aria-label={paneOpen ? "Hide inspector" : "Open inspector"}
          aria-expanded={paneOpen}
          size="sm"
          variant="ghost"
          onClick={() => setWorkspaceToolPaneOpen(store, !paneOpen)}
        >
          {paneOpen ? "Hide inspector" : "Inspect"}
        </Button>
        <Button
          className="md:hidden"
          size="sm"
          variant="outline"
          onClick={() =>
            store.setState((state) => ({
              ...state,
              mobileView:
                mobileView === "conversation" ? "inspect" : "conversation",
              toolPaneOpen: true,
            }))
          }
        >
          {mobileView === "conversation" ? "Inspect" : "Conversation"}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="More workspace actions"
            className="grid size-8 shrink-0 place-items-center rounded-[6px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem
              onClick={() => openWorkspaceTool(store, "terminal")}
            >
              <Terminal /> Command output
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => openWorkspaceTool(store, "checks")}
            >
              Checks · {passedChecks}/{checks.length} passed
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              {agentControllingBrowser
                ? "Agent using preview"
                : browser.status === "live"
                  ? "Preview available"
                  : "Preview unavailable"}
            </DropdownMenuItem>
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
