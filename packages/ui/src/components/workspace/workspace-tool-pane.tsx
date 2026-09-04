"use client"

import {
  Check,
  Files,
  FolderTree,
  Globe2,
  ListChecks,
  MessageSquare,
  PanelRightClose,
  Plus,
  Rocket,
  Terminal,
  X,
} from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"
import type {
  WorkspaceToolTab as WorkspaceTab,
  WorkspaceToolTabKind as WorkspaceTabKind,
} from "@workspace/ui/lib/workspace-tool-state"
import {
  useWorkspaceShell,
  useWorkspaceShellStore,
} from "./workspace-shell-provider"
import {
  activateWorkspaceTool,
  closeWorkspaceTool,
  openWorkspaceTool,
  setWorkspaceToolPaneOpen,
} from "./workspace-shell-store"
import { BrowserPreview } from "./surfaces/browser-preview"
import { CheckList } from "./surfaces/check-list"
import { DeploymentsSurface } from "./surfaces/deployments-surface"
import { FilesSurface } from "./surfaces/files-surface"
import { ReviewNotesSurface } from "./surfaces/review-notes-surface"
import { ReviewSurface } from "./surfaces/review-surface"
import { TerminalSurface } from "./surfaces/terminal-surface"
import type {
  BrowserState,
  CheckItem,
  WorkspaceReview,
  WorkspaceReviewActor,
  WorkspaceReviewCommentDraft,
  WorkspaceCheckpoint,
  WorkspaceDeployments,
  WorkspaceFileChangeView,
  WorkspaceFileContentView,
} from "./types"

function ChecksSurface({ checks }: { checks: CheckItem[] }) {
  return (
    <section className="size-full overflow-auto bg-background">
      <div className="mx-auto w-full max-w-4xl py-3">
        <CheckList checks={checks} />
      </div>
    </section>
  )
}

const workspaceTabIcon = {
  browser: Globe2,
  changes: Files,
  checks: ListChecks,
  review: Check,
  terminal: Terminal,
  files: FolderTree,
  deployments: Rocket,
} satisfies Record<WorkspaceTabKind, typeof MessageSquare>

function WorkspaceTabs({
  activeTabId,
  browser,
  changedFileCount,
  checkpointHistory,
  changeSummary,
  checks,
  onActivateTab,
  onCloseTab,
  onDismiss,
  onOpenTool,
  onAddReviewComment,
  onResolveReviewComment,
  onSubmitReview,
  patch,
  previewContent,
  review,
  reviewPatch,
  currentReviewer,
  reviewPending,
  reviewError,
  tabs,
  files,
  fileChanges,
  onReadFile,
  deployments,
  canDeploy,
  acceptedCommit,
  deployPending,
  deployError,
  onDeploy,
}: {
  activeTabId: string | null
  browser: BrowserState
  changedFileCount?: number
  checkpointHistory?: ReadonlyArray<WorkspaceCheckpoint>
  changeSummary?: string
  checks: CheckItem[]
  onActivateTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onDismiss: () => void
  onOpenTool: (kind: WorkspaceTabKind) => void
  onAddReviewComment?: (
    comment: WorkspaceReviewCommentDraft
  ) => Promise<boolean>
  onResolveReviewComment?: (
    commentId: string,
    resolved: boolean
  ) => Promise<void>
  onSubmitReview?: (decision: "approved" | "changes_requested") => Promise<void>
  patch?: string
  previewContent?: ReactNode
  review?: WorkspaceReview
  reviewPatch?: string
  currentReviewer?: WorkspaceReviewActor
  reviewPending?: boolean
  reviewError?: string | null
  tabs: WorkspaceTab[]
  files: ReadonlyArray<string>
  fileChanges: ReadonlyArray<WorkspaceFileChangeView>
  onReadFile?: (path: string) => Promise<WorkspaceFileContentView>
  deployments: WorkspaceDeployments
  canDeploy: boolean
  acceptedCommit?: string | null
  deployPending?: string | null
  deployError?: string | null
  onDeploy?: (commit: string) => Promise<void>
}) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]
  const tools = [
    { kind: "browser", label: "New browser tab", icon: Globe2 },
    { kind: "changes", label: "Changes", icon: Files },
    { kind: "checks", label: "Checks", icon: ListChecks },
    { kind: "review", label: "Review", icon: Check },
    { kind: "terminal", label: "Terminal", icon: Terminal },
    { kind: "files", label: "Files", icon: FolderTree },
    { kind: "deployments", label: "Deployments", icon: Rocket },
  ] satisfies Array<{
    kind: WorkspaceTabKind
    label: string
    icon: typeof Globe2
  }>

  return (
    <div className="flex size-full min-h-0 flex-col bg-background">
      <div className="flex h-10 shrink-0 items-stretch border-b bg-[#171614]">
        <div
          aria-label="Workspace tool windows"
          className="flex min-w-0 flex-1 items-stretch overflow-x-auto"
          role="tablist"
        >
          {tabs.map((tab) => {
            const Icon = workspaceTabIcon[tab.kind]
            const active = tab.id === activeTab.id
            return (
              <div
                className={cn(
                  "group/tab relative flex shrink-0 items-center border-r border-white/[.07]",
                  active && "bg-background"
                )}
                key={tab.id}
              >
                {active ? (
                  <span className="absolute inset-x-0 top-0 h-px bg-[var(--sylph-coral)]" />
                ) : null}
                <button
                  aria-controls="workspace-tool-panel"
                  aria-selected={active}
                  className={cn(
                    "flex h-full items-center gap-2 px-3 text-xs text-muted-foreground transition-colors hover:bg-white/[.035] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
                    active && "text-foreground"
                  )}
                  id={`workspace-tab-${tab.id}`}
                  onClick={() => onActivateTab(tab.id)}
                  role="tab"
                  type="button"
                >
                  <Icon className="size-3.5" />
                  {tab.label}
                  {tab.kind === "browser" && browser.status === "live" ? (
                    <span
                      aria-label="live"
                      className="size-1.5 rounded-full bg-[var(--sylph-live)]"
                    />
                  ) : null}
                </button>
                <button
                  aria-label={`Close ${tab.label} window`}
                  className="mr-1 grid size-6 place-items-center rounded-[4px] text-muted-foreground/60 opacity-60 transition-opacity hover:bg-white/[.06] hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() => onCloseTab(tab.id)}
                  type="button"
                >
                  <X className="size-3" />
                </button>
              </div>
            )
          })}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Open tool tab"
            className="m-1 grid size-6 shrink-0 place-items-center rounded-[4px] text-muted-foreground hover:bg-white/[.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Plus className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {tools.map(({ kind, label, icon: Icon }) => (
              <DropdownMenuItem key={kind} onClick={() => onOpenTool(kind)}>
                <Icon /> {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          aria-label="Close tool sidebar"
          className="m-1"
          onClick={onDismiss}
          size="icon-xs"
          variant="ghost"
        >
          <PanelRightClose />
        </Button>
      </div>
      <div
        aria-label={activeTab ? undefined : "Tool sidebar"}
        aria-labelledby={
          activeTab ? `workspace-tab-${activeTab.id}` : undefined
        }
        className="flex min-h-0 flex-1 flex-col"
        id="workspace-tool-panel"
        role={activeTab ? "tabpanel" : "region"}
      >
        {!activeTab ? (
          <div className="grid size-full place-items-center px-6 text-center">
            <p className="text-xs text-muted-foreground">
              Open a tool from the + menu.
            </p>
          </div>
        ) : null}
        {activeTab?.kind === "browser" ? (
          <BrowserPreview browser={browser} content={previewContent} />
        ) : null}
        {activeTab?.kind === "changes" ? (
          <ReviewSurface
            changedFileCount={changedFileCount}
            changeSummary={changeSummary}
            checkpointHistory={checkpointHistory}
            patch={patch}
          />
        ) : null}
        {activeTab?.kind === "checks" ? (
          <ChecksSurface checks={checks} />
        ) : null}
        {activeTab?.kind === "review" ? (
          <ReviewNotesSurface
            currentReviewer={currentReviewer}
            error={reviewError}
            onAddComment={onAddReviewComment}
            onResolveComment={onResolveReviewComment}
            onSubmitReview={onSubmitReview}
            patch={reviewPatch}
            pending={reviewPending}
            review={review}
          />
        ) : null}
        {activeTab?.kind === "terminal" ? <TerminalSurface /> : null}
        {activeTab?.kind === "files" ? (
          <FilesSurface
            fileChanges={fileChanges}
            files={files}
            onReadFile={onReadFile}
          />
        ) : null}
        {activeTab?.kind === "deployments" ? (
          <DeploymentsSurface
            acceptedCommit={acceptedCommit}
            canDeploy={canDeploy}
            deployments={deployments}
            error={deployError}
            onDeploy={onDeploy}
            pendingCommit={deployPending}
          />
        ) : null}
      </div>
    </div>
  )
}

export function WorkspaceToolPane({
  browser,
  changedFileCount,
  checkpointHistory,
  changeSummary,
  checks,
  onAddReviewComment,
  onResolveReviewComment,
  onSubmitReview,
  patch,
  previewContent,
  review,
  reviewPatch,
  currentReviewer,
  reviewPending,
  reviewError,
  files = [],
  fileChanges = [],
  onReadFile,
  deployments = { acceptedCommits: [], deployments: [] },
  canDeploy = false,
  acceptedCommit,
  deployPending,
  deployError,
  onDeploy,
}: {
  browser: BrowserState
  changedFileCount?: number
  checkpointHistory?: ReadonlyArray<WorkspaceCheckpoint>
  changeSummary?: string
  checks: CheckItem[]
  onAddReviewComment?: (
    comment: WorkspaceReviewCommentDraft
  ) => Promise<boolean>
  onResolveReviewComment?: (
    commentId: string,
    resolved: boolean
  ) => Promise<void>
  onSubmitReview?: (decision: "approved" | "changes_requested") => Promise<void>
  patch?: string
  previewContent?: ReactNode
  review?: WorkspaceReview
  reviewPatch?: string
  currentReviewer?: WorkspaceReviewActor
  reviewPending?: boolean
  reviewError?: string | null
  files?: ReadonlyArray<string>
  fileChanges?: ReadonlyArray<WorkspaceFileChangeView>
  onReadFile?: (path: string) => Promise<WorkspaceFileContentView>
  deployments?: WorkspaceDeployments
  canDeploy?: boolean
  acceptedCommit?: string | null
  deployPending?: string | null
  deployError?: string | null
  onDeploy?: (commit: string) => Promise<void>
}) {
  const store = useWorkspaceShellStore()
  const tabs = useWorkspaceShell((state) => state.tabs)
  const activeTabId = useWorkspaceShell((state) => state.activeTabId)

  return (
    <WorkspaceTabs
      activeTabId={activeTabId}
      browser={browser}
      changedFileCount={changedFileCount}
      checkpointHistory={checkpointHistory}
      changeSummary={changeSummary}
      checks={checks}
      currentReviewer={currentReviewer}
      onActivateTab={(tabId) => activateWorkspaceTool(store, tabId)}
      onAddReviewComment={onAddReviewComment}
      onCloseTab={(tabId) => closeWorkspaceTool(store, tabId)}
      onDismiss={() => setWorkspaceToolPaneOpen(store, false)}
      onOpenTool={(kind) => openWorkspaceTool(store, kind)}
      onResolveReviewComment={onResolveReviewComment}
      onSubmitReview={onSubmitReview}
      patch={patch}
      previewContent={previewContent}
      review={review}
      reviewError={reviewError}
      reviewPatch={reviewPatch}
      reviewPending={reviewPending}
      tabs={tabs}
      files={files}
      fileChanges={fileChanges}
      onReadFile={onReadFile}
      deployments={deployments}
      canDeploy={canDeploy}
      acceptedCommit={acceptedCommit}
      deployPending={deployPending}
      deployError={deployError}
      onDeploy={onDeploy}
    />
  )
}
