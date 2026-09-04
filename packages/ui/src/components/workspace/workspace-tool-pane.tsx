"use client"

import { Maximize2, Minimize2, MoreHorizontal } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { ToolCall } from "@workspace/ui/components/tool-call"
import { cn } from "@workspace/ui/lib/utils"
import {
  useWorkspaceShell,
  useWorkspaceShellStore,
} from "./workspace-shell-provider"
import {
  openWorkspaceTool,
  referenceWorkspaceContext,
} from "./workspace-shell-store"
import {
  WorkspacePatchSurface,
  type WorkspacePatchReader,
} from "./surfaces/workspace-patch-surface"
import { BrowserPreview } from "./surfaces/browser-preview"
import { CheckList } from "./surfaces/check-list"
import { DeploymentsSurface } from "./surfaces/deployments-surface"
import { FilesSurface } from "./surfaces/files-surface"
import { ReviewNotesSurface } from "./surfaces/review-notes-surface"
import { ReviewSurface } from "./surfaces/review-surface"
import type {
  BrowserState,
  CheckItem,
  ThreadEntry,
  WorkspaceReview,
  WorkspaceReviewActor,
  WorkspaceReviewCommentDraft,
  WorkspaceCheckpoint,
  WorkspaceDeployments,
  WorkspaceFileChangeView,
  WorkspaceFileContentView,
} from "./types"

export function WorkspaceToolPane({
  onCheckpoint,
  checkpointDisabled = true,
  checkpointPending = false,
  onAccept,
  acceptDisabled = true,
  acceptPending = false,
  acceptBlockers = [],
  changeError,
  entries = [],
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
  onReadPatch,
  patchRevision,
  reviewPatchRevision,
  deployments = { acceptedCommits: [], deployments: [] },
  canDeploy = false,
  acceptedCommit,
  deployPending,
  deployError,
  onDeploy,
}: {
  onCheckpoint?: () => Promise<void>
  checkpointDisabled?: boolean
  checkpointPending?: boolean
  onAccept?: () => Promise<void>
  acceptDisabled?: boolean
  acceptPending?: boolean
  acceptBlockers?: ReadonlyArray<string>
  changeError?: string | null
  entries?: ThreadEntry[]
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
  onReadPatch?: WorkspacePatchReader
  patchRevision?: string | number
  reviewPatchRevision?: string | number
  deployments?: WorkspaceDeployments
  canDeploy?: boolean
  acceptedCommit?: string | null
  deployPending?: string | null
  deployError?: string | null
  onDeploy?: (commit: string) => Promise<void>
}) {
  const store = useWorkspaceShellStore()
  const active = useWorkspaceShell((state) => state.activeTabId ?? "browser")
  const expanded = useWorkspaceShell((state) => state.expanded)
  const scope = useWorkspaceShell((state) => state.changeScope ?? "working")
  const activityId = useWorkspaceShell((state) => state.activityId)
  const activity = entries.find((entry) => entry.id === activityId)?.tool
  const reference = (label: string, text: string) =>
    referenceWorkspaceContext(store, { label, text })
  const checkpointChecks = checks.filter(
    (check) =>
      check.commit === review?.commit &&
      check.commit !== undefined &&
      check.target !== "production"
  )

  return (
    <section
      aria-label="Workspace inspector"
      className="flex size-full min-h-0 flex-col bg-background"
    >
      <header className="flex h-11 shrink-0 items-center gap-1 border-b px-2">
        <nav
          aria-label="Inspect workspace"
          className="flex min-w-0 flex-1 items-center gap-1"
        >
          {(
            [
              ["browser", "Preview"],
              ["changes", "Changes"],
              ["files", "Files"],
            ] as const
          ).map(([kind, label]) => (
            <Button
              key={kind}
              aria-pressed={active === kind}
              variant="ghost"
              size="sm"
              className={cn(
                "px-2",
                active === kind && "bg-accent text-foreground"
              )}
              onClick={() => openWorkspaceTool(store, kind)}
            >
              {label}
              {kind === "changes" && changedFileCount ? (
                <span className="text-muted-foreground tabular-nums">
                  {changedFileCount}
                </span>
              ) : null}
            </Button>
          ))}
        </nav>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="More inspection tools"
            className="grid size-8 shrink-0 place-items-center rounded-md hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => openWorkspaceTool(store, "checks")}
            >
              Checks and evidence
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => openWorkspaceTool(store, "deployments")}
            >
              Deployments
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => openWorkspaceTool(store, "terminal")}
            >
              Command output
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          className="hidden md:inline-flex"
          aria-label={expanded ? "Restore conversation" : "Expand inspector"}
          aria-pressed={expanded}
          size="icon-sm"
          variant="ghost"
          onClick={() =>
            store.setState((state) => ({ ...state, expanded: !state.expanded }))
          }
        >
          {expanded ? <Minimize2 /> : <Maximize2 />}
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        {active === "browser" ? (
          <BrowserPreview
            browser={browser}
            content={previewContent}
            onReference={() =>
              reference(
                "Preview",
                `Preview: ${browser.url}${browser.commit ? `\nCheckpoint: ${browser.commit}` : ""}`
              )
            }
          />
        ) : null}
        {active === "changes" ? (
          <>
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
              <label
                className="text-xs text-muted-foreground"
                htmlFor="workspace-change-scope"
              >
                Compare
              </label>
              <select
                id="workspace-change-scope"
                value={scope}
                className="min-w-0 rounded-md border bg-background px-2 py-1.5 text-xs focus-visible:ring-2 focus-visible:ring-ring"
                onChange={(event) => {
                  const changeScope =
                    event.target.value === "branch" ? "branch" : "working"
                  store.setState((state) => ({ ...state, changeScope }))
                }}
              >
                <option value="working">Working copy</option>
                <option value="branch" disabled={!review}>
                  Checkpoint{review ? ` ${review.commit.slice(0, 7)}` : ""}
                </option>
              </select>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <WorkspacePatchSurface
                scope={scope}
                revision={
                  scope === "working" ? patchRevision : reviewPatchRevision
                }
                readPatch={onReadPatch}
                patch={scope === "working" ? patch : reviewPatch}
              >
                {(loadedPatch) =>
                  scope === "working" ? (
                    <ReviewSurface
                      patch={loadedPatch}
                      changedFileCount={changedFileCount}
                      changeSummary={changeSummary}
                      checkpointHistory={checkpointHistory}
                      onReference={(selection) =>
                        reference(
                          selection.file,
                          `Working copy: ${selection.file}\nLines ${selection.start}-${selection.end} (${selection.endSide ?? selection.side ?? "additions"})`
                        )
                      }
                    />
                  ) : (
                    <ReviewNotesSurface
                      currentReviewer={currentReviewer}
                      error={reviewError}
                      onAddComment={onAddReviewComment}
                      onResolveComment={onResolveReviewComment}
                      onSubmitReview={onSubmitReview}
                      patch={loadedPatch}
                      pending={reviewPending}
                      review={review}
                      onReference={(selection) =>
                        reference(
                          selection.file,
                          `Checkpoint: ${review?.commit}\nFile: ${selection.file}\nLines ${selection.start}-${selection.end} (${selection.endSide ?? selection.side ?? "additions"})`
                        )
                      }
                    />
                  )
                }
              </WorkspacePatchSurface>
            </div>
            {scope === "branch" && checkpointChecks.length ? (
              <details className="max-h-48 shrink-0 overflow-auto border-t">
                <summary className="cursor-pointer px-3 py-2 text-xs focus-visible:ring-2 focus-visible:ring-ring">
                  Checkpoint checks ·{" "}
                  {
                    checkpointChecks.filter(
                      (check) => check.status === "passed"
                    ).length
                  }
                  /{checkpointChecks.length} passed
                </summary>
                <CheckList checks={checkpointChecks} />
              </details>
            ) : null}
            <footer className="shrink-0 border-t px-3 py-3">
              {changeError ? (
                <p role="alert" className="mb-2 text-xs text-destructive">
                  {changeError}
                </p>
              ) : null}
              {scope === "branch" && acceptBlockers.length ? (
                <p className="mb-2 text-xs leading-5 text-muted-foreground">
                  {acceptBlockers.join(" ")}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  {scope === "working"
                    ? "Save changes for review"
                    : "Accept the reviewed checkpoint"}
                </span>
                {scope === "working" ? (
                  <Button
                    size="sm"
                    disabled={
                      !onCheckpoint || checkpointDisabled || checkpointPending
                    }
                    onClick={() => void onCheckpoint?.()}
                  >
                    {checkpointPending ? "Saving…" : "Checkpoint"}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={!onAccept || acceptDisabled || acceptPending}
                    onClick={() => void onAccept?.()}
                  >
                    {acceptPending ? "Accepting…" : "Accept checkpoint"}
                  </Button>
                )}
              </div>
            </footer>
          </>
        ) : null}
        <div
          className={cn("min-h-0 flex-1", active !== "files" && "hidden")}
          hidden={active !== "files"}
        >
          <FilesSurface
            fileChanges={fileChanges}
            files={files}
            onReadFile={onReadFile}
            onReferenceFile={(path) =>
              reference(path, `Workspace file: ${path}`)
            }
          />
        </div>
        {active === "checks" ? (
          <section className="min-h-0 flex-1 overflow-auto">
            <header className="flex items-center justify-between border-b px-3 py-2">
              <h2 className="text-sm font-medium">
                {activity ? "Activity details" : "Checks and evidence"}
              </h2>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => openWorkspaceTool(store, "browser")}
              >
                Back to preview
              </Button>
            </header>
            {activity ? (
              <div className="p-3">
                <ToolCall part={activity} />
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    reference(
                      activity.name,
                      `Tool call: ${activity.name}\nCall ID: ${activity.id}`
                    )
                  }
                >
                  Reference in chat
                </Button>
              </div>
            ) : (
              <CheckList checks={checks} />
            )}
          </section>
        ) : null}
        {active === "deployments" ? (
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
    </section>
  )
}
