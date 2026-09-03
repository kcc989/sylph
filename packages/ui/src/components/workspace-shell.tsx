"use client"

import {
  Activity,
  Archive,
  ArrowUp,
  BadgeCheck,
  Blocks,
  Check,
  ChevronRight,
  CircleHelp,
  CircleAlert,
  Files,
  GitBranch,
  GitCommit,
  GitCompareArrows,
  GitMerge,
  Globe2,
  House,
  LoaderCircle,
  ListChecks,
  Maximize2,
  MessageSquare,
  MessageCircle,
  MessagesSquare,
  Monitor,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Smartphone,
  Square,
  Terminal,
  Trash2,
  AtSign,
  X,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  useDefaultLayout,
  type PanelImperativeHandle,
} from "react-resizable-panels"
import remarkGfm from "remark-gfm"

import { Badge } from "@workspace/ui/components/badge"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import { ModelCombobox as SharedModelCombobox } from "@workspace/ui/components/model-combobox"
import {
  isWorkspaceCommandPending,
  pendingWorkspaceCommandTarget,
  workspaceCommandErrorExcept,
  workspaceCommandErrorMessage,
  type WorkspaceCommandError,
  type WorkspaceCommandName,
  type WorkspacePendingCommand,
} from "@workspace/ui/lib/workspace-commands"
import {
  CodeReview,
  type CodeReviewAnnotation,
  type CodeReviewSelection,
  type CodeReviewSide,
} from "@workspace/ui/components/code-review"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { workspaceStatusStyles } from "@workspace/ui/lib/status-styles"
import {
  readWorkspaceToolState,
  writeWorkspaceToolState,
  type WorkspaceToolTab as WorkspaceTab,
  type WorkspaceToolTabKind as WorkspaceTabKind,
} from "@workspace/ui/lib/workspace-tool-state"

type WorkspaceStatus = "running" | "waiting" | "ready" | "archived" | "error"

const workspacePanelStorage = {
  getItem: (name: string) => {
    try {
      return window.localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name: string, value: string) => {
    try {
      window.localStorage.setItem(name, value)
    } catch {
      return
    }
  },
}

type WorkspaceItem = {
  id: string
  name: string
  href?: string
  branch: string
  status: WorkspaceStatus
  changes?: string
}

type ProjectGroup = {
  id: string
  name: string
  repositoryName: string
  creatingWorkspace?: boolean
  onCreateWorkspace?: () => void
  settingsHref?: string
  workspaces: WorkspaceItem[]
}

type ThreadEntry = {
  id: string
  kind: "user" | "agent" | "tool" | "result"
  title?: string
  body: string
  skill?: {
    name: string
    scope: "installation" | "project"
    prompt: string
  }
  meta?: string
  details?: string[]
  artifact?: { label: string; detail: string }
}

type WorkspacePermissionRequest = {
  id: string
  action: string
  resources: string[]
  message?: string
  canSave: boolean
}

type WorkspaceQuestionValue = string | number | boolean | ReadonlyArray<string>

type WorkspaceQuestion = {
  id: string
  title: string
  status: "pending" | "answered" | "cancelled"
  fields: ReadonlyArray<{
    key: string
    title?: string
    description?: string
    required?: boolean
    type:
      | "string"
      | "number"
      | "integer"
      | "boolean"
      | "multiselect"
      | "external"
    options: ReadonlyArray<{
      value: string
      label: string
      description?: string
    }>
    placeholder?: string
    url?: string
    defaultValue?: WorkspaceQuestionValue
  }>
  answer: Record<string, WorkspaceQuestionValue> | null
}

type WorkspaceQueuedMessage = {
  id: string
  text: string
  createdAt: number
  delivery: "queue" | "steer"
}

type WorkspaceRuntimeLimits = {
  maxQueuedMessages: number
  maxTurnDurationMs: number
  maxCheckAttempts: number
  maxRepairAttempts: number
  maxAutomaticRepairs?: number
}

type BrowserState = {
  url: string
  title: string
  status: "live" | "loading" | "error"
}

type CheckItem = {
  name: string
  detail: string
  status: "queued" | "passed" | "running" | "failed"
  output?: string
  evidence?: ReadonlyArray<{
    id: string
    kind: "screenshot" | "accessibility"
    label: string
    url: string
  }>
  action?: {
    label: string
    disabled?: boolean
    onClick: () => void
  }
}

type WorkspaceReviewActor = {
  id: string
  name: string
  image: string | null
}

type WorkspaceReviewComment = {
  id: string
  file: string
  side: CodeReviewSide
  startLine: number
  endLine: number
  body: string
  author: WorkspaceReviewActor
  createdAt: number
  resolvedAt: number | null
  resolvedBy: WorkspaceReviewActor | null
}

type WorkspaceReview = {
  commit: string
  decision: "pending" | "approved" | "changes_requested"
  reviewer: WorkspaceReviewActor | null
  submittedAt: number | null
  comments: ReadonlyArray<WorkspaceReviewComment>
}

type WorkspaceReviewCommentDraft = {
  file: string
  side: CodeReviewSide
  startLine: number
  endLine: number
  body: string
}

export type ComposerModel = {
  providerId: string
  modelId: string
  name: string
  providerName: string
  scope: "personal" | "organization"
}

export type ComposerSkill = {
  name: string
  description: string
  scope: "installation" | "project"
}

type WorkspaceShellProps = {
  workspaceId: string
  canAdminister?: boolean
  organization?: string
  projectName: string
  repositoryName: string
  workspaceName: string
  projects?: ProjectGroup[]
  entries?: ThreadEntry[]
  browser?: BrowserState
  checks?: CheckItem[]
  patch?: string
  changeSummary?: string
  changedFileCount?: number
  checkpointHistory?: ReadonlyArray<{
    id: string
    commit: string
    message: string
    createdAt: number
  }>
  review?: WorkspaceReview
  reviewPatch?: string
  currentReviewer?: WorkspaceReviewActor
  previewContent?: ReactNode
  agentControllingBrowser?: boolean
  demo?: boolean
  className?: string
  models?: ReadonlyArray<ComposerModel>
  skills?: ReadonlyArray<ComposerSkill>
  selectedModel?: { providerId: string; modelId: string } | null
  modelNotice?: string | null
  initialPrompt?: string
  promptDisabled?: boolean
  pending?: ReadonlyArray<WorkspacePendingCommand>
  commandError?: WorkspaceCommandError | null
  permissionRequests?: ReadonlyArray<WorkspacePermissionRequest>
  questions?: ReadonlyArray<WorkspaceQuestion>
  queuedMessages?: ReadonlyArray<WorkspaceQueuedMessage>
  runtimeLimits?: WorkspaceRuntimeLimits
  turnActive?: boolean
  turnInterrupted?: boolean
  activeTurnStartedAt?: number | null
  onAccept?: () => Promise<void>
  onAddReviewComment?: (
    comment: WorkspaceReviewCommentDraft
  ) => Promise<boolean>
  onCheckpoint?: () => Promise<void>
  onSubmitPrompt?: (
    text: string,
    model: { providerId: string; modelId: string },
    delivery?: "queue" | "steer"
  ) => Promise<void>
  onCancelTurn?: () => Promise<void>
  onAnswerQuestion?: (
    questionId: string,
    answer: Record<string, WorkspaceQuestionValue>
  ) => Promise<void>
  onPermissionReply?: (
    requestId: string,
    reply: "once" | "always" | "reject"
  ) => Promise<void>
  onModelChange?: (model: { providerId: string; modelId: string }) => void
  onRestartWorkspace?: () => Promise<void>
  onArchiveWorkspace?: () => Promise<void>
  onDiscardWorkspace?: () => Promise<void>
  onRebase?: () => Promise<void>
  onResolveReviewComment?: (
    commentId: string,
    resolved: boolean
  ) => Promise<void>
  onSubmitReview?: (decision: "approved" | "changes_requested") => Promise<void>
  onOpenSearch?: () => void
  workspaceError?: string | null
}

function SylphMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 20 20"
      fill="none"
    >
      <path d="M10 1.5 14.25 6 10 10.5 5.75 6 10 1.5Z" fill="currentColor" />
      <path
        d="m5.2 8.1 3.4 3.6-3.4 3.6-3.4-3.6 3.4-3.6Z"
        fill="currentColor"
        opacity=".72"
      />
      <path
        d="m14.8 8.1 3.4 3.6-3.4 3.6-3.4-3.6 3.4-3.6Z"
        fill="currentColor"
        opacity=".72"
      />
      <path
        d="m10 13 3 3.1-3 2.4-3-2.4 3-3.1Z"
        fill="currentColor"
        opacity=".45"
      />
    </svg>
  )
}

const fallbackProjects: ProjectGroup[] = [
  {
    id: "sylph",
    name: "Sylph",
    repositoryName: "sylph",
    workspaces: [
      {
        id: "preview",
        name: "Browser preview shell",
        branch: "codex/browser-shell",
        status: "running",
        changes: "+286 −41",
      },
      {
        id: "skills",
        name: "Skills integration",
        branch: "codex/skills",
        status: "ready",
        changes: "+74 −8",
      },
      {
        id: "runtime",
        name: "Remote runtime",
        branch: "main",
        status: "waiting",
      },
    ],
  },
  {
    id: "open-relic",
    name: "Open Relic",
    repositoryName: "open-relic",
    workspaces: [
      {
        id: "artifact",
        name: "Artifact transport",
        branch: "codex/artifacts",
        status: "ready",
        changes: "+31 −2",
      },
    ],
  },
]

const fallbackEntries: ThreadEntry[] = [
  {
    id: "request",
    kind: "user",
    body: "Keep the workspace focused on chat and open a browser only when preview work begins.",
    meta: "You · 10:24",
  },
  {
    id: "inspect",
    kind: "tool",
    title: "Plan",
    body: "Move chat, browser, changes, checks, and terminal into one peer tab model.",
    meta: "4 steps",
    details: [
      "Audit the workspace shell and preview route",
      "Keep Project → Workspace hierarchy persistent",
      "Verify the browser at mobile and desktop widths",
      "Run typecheck, accessibility, and build checks",
    ],
  },
  {
    id: "result",
    kind: "result",
    title: "Workspace tabs implemented",
    body: "Chat opens first. Browser and review tools stay one click away without shrinking the active work surface.",
    meta: "2m 18s",
    artifact: {
      label: "Preview updated",
      detail: "http://127.0.0.1:3000/workspaces/preview",
    },
  },
  {
    id: "agent",
    kind: "agent",
    body: "I’m testing the workspace at desktop and mobile widths now. The browser remains the active target while the checks run.",
    meta: "Agent · now",
    artifact: { label: "Browser checks", detail: "3/3 passing" },
  },
]

const fallbackChecks: CheckItem[] = [
  { name: "Typecheck", detail: "packages/ui", status: "passed" },
  { name: "Responsive preview", detail: "390px · 1440px", status: "running" },
  { name: "Accessibility", detail: "Storybook", status: "passed" },
]

function UtilityRail({
  canAdminister,
  onOpenSearch,
}: {
  canAdminister: boolean
  onOpenSearch?: () => void
}) {
  const items = [
    { label: "Projects", icon: House, href: "/" },
    ...(canAdminister
      ? [{ label: "Administration", icon: ShieldCheck, href: "/admin" }]
      : []),
  ]

  return (
    <aside
      aria-label="Product navigation"
      className="hidden w-12 shrink-0 flex-col items-center border-r bg-[var(--sylph-ink)] py-2.5 md:flex"
    >
      <a
        aria-label="Sylph home"
        href="/"
        className="mb-4 grid size-7 place-items-center rounded-[6px] border border-white/10 bg-[#f0a087] text-[#241613]"
      >
        <SylphMark className="size-4" />
      </a>
      <nav className="grid gap-1" aria-label="Workspace tools">
        {items.map(({ label, icon: Icon, href }) => (
          <Tooltip key={label}>
            <TooltipTrigger
              aria-label={label}
              render={<a href={href} />}
              className="grid size-8 place-items-center rounded-[6px] text-muted-foreground transition-colors hover:bg-white/[.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Icon className="size-4" />
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ))}
        <Tooltip>
          <TooltipTrigger
            aria-label="Search"
            className="grid size-8 place-items-center rounded-[6px] text-muted-foreground transition-colors hover:bg-white/[.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            onClick={onOpenSearch}
          >
            <Search className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="right">Search</TooltipContent>
        </Tooltip>
      </nav>
      <div className="mt-auto grid gap-1">
        <Tooltip>
          <TooltipTrigger
            aria-label="Getting started"
            render={<a href="/?onboarding=1" />}
            className="grid size-8 place-items-center rounded-[6px] text-muted-foreground transition-colors hover:bg-white/[.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <CircleHelp className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="right">Getting started</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            aria-label="User settings"
            render={<a href="/settings" />}
            className="grid size-8 place-items-center rounded-[6px] text-muted-foreground transition-colors hover:bg-white/[.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Settings2 className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="right">User settings</TooltipContent>
        </Tooltip>
      </div>
    </aside>
  )
}

function ProjectRail({
  organization,
  projects,
  workspaceName,
  mobile,
  onClose,
}: {
  organization: string
  projects: ProjectGroup[]
  workspaceName: string
  mobile?: boolean
  onClose?: () => void
}) {
  return (
    <aside
      aria-label="Project and workspace navigation"
      aria-modal={mobile || undefined}
      role={mobile ? "dialog" : undefined}
      className={cn(
        "h-full min-w-0 shrink-0 flex-col overflow-hidden bg-sidebar",
        mobile ? "flex w-[268px] border-r" : "hidden w-full md:flex"
      )}
    >
      <header className="flex h-12 min-w-0 items-center gap-2 overflow-hidden border-b px-3">
        <div className="grid size-6 shrink-0 place-items-center rounded-[5px] bg-foreground text-[10px] font-bold text-background">
          {organization.slice(0, 1).toUpperCase()}
        </div>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {organization}
        </span>
        <Button
          aria-label={mobile ? "Close navigation" : "Collapse sidebar"}
          size="icon-xs"
          variant="ghost"
          onClick={onClose}
        >
          <PanelLeftClose />
        </Button>
      </header>
      <div className="flex h-10 min-w-0 items-center justify-between px-3">
        <span className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Projects
        </span>
        <Button aria-label="Add project" size="icon-xs" variant="ghost">
          <Plus />
        </Button>
      </div>
      <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-hidden px-2 pb-3">
        <div className="grid w-full min-w-0 gap-3 overflow-hidden">
          {projects.map((project) => (
            <section className="min-w-0 overflow-hidden" key={project.id}>
              <div className="flex h-9 w-full min-w-0 items-center gap-2 overflow-hidden px-2 text-xs font-semibold text-foreground/85">
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                <Button
                  aria-label={`New workspace in ${project.name}`}
                  disabled={
                    !project.onCreateWorkspace || project.creatingWorkspace
                  }
                  size="icon-xs"
                  variant="ghost"
                  className="shrink-0"
                  onClick={project.onCreateWorkspace}
                >
                  {project.creatingWorkspace ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Plus />
                  )}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={`Open ${project.name} menu`}
                    className="grid size-6 shrink-0 place-items-center rounded-[4px] text-muted-foreground hover:bg-white/[.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                      disabled={
                        !project.onCreateWorkspace || project.creatingWorkspace
                      }
                      onClick={project.onCreateWorkspace}
                    >
                      {project.creatingWorkspace ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <Plus />
                      )}
                      New Workspace
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!project.settingsHref}
                      onClick={() => {
                        if (project.settingsHref) {
                          window.location.assign(project.settingsHref)
                        }
                      }}
                    >
                      <Settings2 /> Project settings
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="grid w-full min-w-0 gap-0.5 overflow-hidden pr-1 pl-2">
                {project.workspaces.map((workspace) => {
                  const active = workspace.name === workspaceName
                  const label =
                    workspace.name === project.name
                      ? workspace.branch
                      : workspace.name
                  return (
                    <a
                      key={workspace.id}
                      href={workspace.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group flex h-8 w-full max-w-full min-w-0 items-center gap-2 overflow-hidden rounded-[5px] px-2 text-left transition-colors hover:bg-white/[.045] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                        active && "bg-white/[.065]"
                      )}
                    >
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-xs",
                          active
                            ? "font-medium text-foreground"
                            : "text-muted-foreground group-hover:text-foreground/80"
                        )}
                      >
                        {label}
                      </span>
                      {workspace.changes && (
                        <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                          {workspace.changes}
                        </span>
                      )}
                      <span
                        role="status"
                        className={cn(
                          "grid size-3.5 shrink-0 place-items-center",
                          workspaceStatusStyles[workspace.status]
                        )}
                      >
                        <span className="size-1.5 rounded-full bg-current" />
                        <span className="sr-only">
                          Workspace status: {workspace.status}
                        </span>
                      </span>
                    </a>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      </ScrollArea>
      <footer className="flex h-10 items-center gap-2 border-t px-3 text-[10px] text-muted-foreground">
        <span className="size-1.5 rounded-full bg-[var(--sylph-live)]" />
        Remote workspace connected
      </footer>
    </aside>
  )
}

function WorkspaceTopbar({
  agentControllingBrowser,
  browser,
  checks,
  demo,
  projectName,
  repositoryName,
  workspaceName,
  navigationCollapsed,
  onOpenNavigation,
  onOpenTerminal,
  onCheckpoint,
  checkpointDisabled,
  checkpointPending,
  onAccept,
  acceptDisabled,
  acceptPending,
  onRestartWorkspace,
  restartPending,
  onArchiveWorkspace,
  archivePending,
  onDiscardWorkspace,
  discardPending,
  onRebase,
  rebasePending,
}: {
  agentControllingBrowser: boolean
  browser: BrowserState
  checks: CheckItem[]
  demo: boolean
  projectName: string
  repositoryName: string
  workspaceName: string
  navigationCollapsed: boolean
  onOpenNavigation: () => void
  onOpenTerminal: () => void
  onCheckpoint?: () => Promise<void>
  checkpointDisabled: boolean
  checkpointPending: boolean
  onAccept?: () => Promise<void>
  acceptDisabled: boolean
  acceptPending: boolean
  onRestartWorkspace?: () => Promise<void>
  restartPending: boolean
  onArchiveWorkspace?: () => Promise<void>
  archivePending: boolean
  onDiscardWorkspace?: () => Promise<void>
  discardPending: boolean
  onRebase?: () => Promise<void>
  rebasePending: boolean
}) {
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
        onClick={onOpenNavigation}
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
      {demo && (
        <Badge className="rounded-[4px] px-1.5 text-[9px]" variant="outline">
          Demo
        </Badge>
      )}
      {browser.status === "live" && (
        <Badge
          className="hidden rounded-[5px] border-white/10 bg-white/[.045] px-1.5 text-[10px] font-normal text-muted-foreground sm:inline-flex"
          variant="outline"
        >
          <span className="size-1.5 rounded-full bg-[var(--sylph-live)]" /> Live
        </Badge>
      )}
      <div className="ml-auto flex items-center gap-1.5">
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
          onClick={onOpenTerminal}
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

function ResponseMarkdown({ children }: { children: string }) {
  return (
    <div className="min-w-0 text-[13px] leading-5 text-foreground/80 [&_a]:font-medium [&_a]:text-[#ef9b7e] [&_a]:underline [&_a]:decoration-[#ef9b7e]/40 [&_a]:underline-offset-2 [&_blockquote]:my-3 [&_blockquote]:border-l [&_blockquote]:border-white/15 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded-[4px] [&_code]:bg-white/[.07] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-foreground/90 [&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-[13px] [&_h3]:font-semibold [&_hr]:my-4 [&_hr]:border-white/10 [&_li]:pl-0.5 [&_ol]:my-2 [&_ol]:grid [&_ol]:list-decimal [&_ol]:gap-1 [&_ol]:pl-5 [&_p+p]:mt-3 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-white/[.08] [&_pre]:bg-black/25 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-3 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_td]:border-b [&_td]:border-white/[.07] [&_td]:px-2 [&_td]:py-1.5 [&_th]:border-b [&_th]:border-white/15 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium [&_ul]:my-2 [&_ul]:grid [&_ul]:list-disc [&_ul]:gap-1 [&_ul]:pl-5 [&>:first-child]:mt-0 [&>:last-child]:mb-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}

function SkillInvocationMessage({ entry }: { entry: ThreadEntry }) {
  if (!entry.skill) {
    return (
      <p className="text-[13px] leading-5 whitespace-pre-wrap text-foreground">
        {entry.body}
      </p>
    )
  }

  return (
    <div className="grid justify-items-start gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-label={`Invoked ${entry.skill.name} Skill`}
          className="inline-flex h-6 items-center gap-1.5 rounded-[5px] border border-[#ef9b7e]/30 bg-[#ef9b7e]/10 px-2 text-[#ef9b7e]"
        >
          <Blocks aria-hidden="true" className="size-3.5" />
          <span className="font-mono text-[11px] font-medium">
            /{entry.skill.name}
          </span>
        </span>
        <span className="text-[10px] text-muted-foreground">
          {entry.skill.scope === "project"
            ? "Project skill"
            : "Installation skill"}
        </span>
      </div>
      {entry.skill.prompt && (
        <p className="text-[13px] leading-5 whitespace-pre-wrap text-foreground">
          {entry.skill.prompt}
        </p>
      )}
    </div>
  )
}

function AgentQuestion({
  question,
  pending,
  onAnswer,
}: {
  question: WorkspaceQuestion
  pending: boolean
  onAnswer?: (
    questionId: string,
    answer: Record<string, WorkspaceQuestionValue>
  ) => Promise<void>
}) {
  if (question.status !== "pending") {
    return (
      <article className="min-w-0 border border-white/[.1] bg-white/[.025] px-3.5 py-3">
        <div className="flex items-center gap-2">
          <CircleHelp className="size-4 shrink-0 text-muted-foreground" />
          <h3 className="min-w-0 flex-1 text-[13px] font-medium">
            {question.title}
          </h3>
          <span className="text-[10px] text-muted-foreground">
            {question.status === "answered" ? "Answered" : "Cancelled"}
          </span>
        </div>
        {question.answer ? (
          <dl className="mt-3 grid gap-2 border-t border-white/[.07] pt-3">
            {Object.entries(question.answer).map(([key, value]) => (
              <div className="grid gap-0.5 sm:grid-cols-[10rem_1fr]" key={key}>
                <dt className="text-[10px] text-muted-foreground">{key}</dt>
                <dd className="min-w-0 text-[12px] break-words text-foreground/80">
                  {Array.isArray(value) ? value.join(", ") : String(value)}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </article>
    )
  }

  return (
    <form
      className="min-w-0 border border-[#ef9b7e]/30 bg-[#ef9b7e]/[.055] px-3.5 py-3"
      onSubmit={(event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        const answer: Record<string, WorkspaceQuestionValue> = {}
        for (const field of question.fields) {
          if (field.type === "external") continue
          if (field.type === "multiselect") {
            answer[field.key] = form.getAll(field.key).map(String)
            continue
          }
          if (field.type === "boolean") {
            answer[field.key] = form.get(field.key) === "true"
            continue
          }
          const value = String(form.get(field.key) ?? "")
          answer[field.key] =
            field.type === "number" || field.type === "integer"
              ? Number(value)
              : value
        }
        void onAnswer?.(question.id, answer)
      }}
    >
      <div className="flex items-start gap-3">
        <CircleHelp className="mt-0.5 size-4 shrink-0 text-[#ef9b7e]" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-medium">{question.title}</h3>
          <div className="mt-3 grid gap-3">
            {question.fields.map((field) => (
              <fieldset className="min-w-0" key={field.key}>
                <label
                  className="block text-[11px] font-medium text-foreground/85"
                  htmlFor={`${question.id}-${field.key}`}
                >
                  {field.title ?? field.key}
                  {field.required ? (
                    <span className="text-[#ef9b7e]"> *</span>
                  ) : null}
                </label>
                {field.description ? (
                  <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
                    {field.description}
                  </p>
                ) : null}
                {field.type === "external" ? (
                  <a
                    className="mt-1.5 inline-flex min-h-8 items-center text-[11px] font-medium text-[#ef9b7e] underline decoration-[#ef9b7e]/40 underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    href={field.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open required context
                  </a>
                ) : field.type === "boolean" ? (
                  <input
                    className="mt-2 size-4 accent-[#ef9b7e]"
                    defaultChecked={field.defaultValue === true}
                    id={`${question.id}-${field.key}`}
                    name={field.key}
                    type="checkbox"
                    value="true"
                  />
                ) : field.type === "multiselect" ? (
                  <div className="mt-1.5 grid gap-1.5">
                    {field.options.map((option) => (
                      <label
                        className="flex min-w-0 items-start gap-2 text-[11px] text-foreground/80"
                        key={option.value}
                      >
                        <input
                          className="mt-0.5 size-4 shrink-0 accent-[#ef9b7e]"
                          defaultChecked={
                            Array.isArray(field.defaultValue) &&
                            field.defaultValue.includes(option.value)
                          }
                          name={field.key}
                          type="checkbox"
                          value={option.value}
                        />
                        <span className="min-w-0">
                          {option.label}
                          {option.description ? (
                            <span className="block text-[10px] text-muted-foreground">
                              {option.description}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : field.options.length ? (
                  <select
                    className="mt-1.5 h-9 w-full rounded-[5px] border border-white/[.12] bg-[#171614] px-2 text-base text-foreground outline-none focus:border-[#ef9b7e]/60 focus:ring-2 focus:ring-[#ef9b7e]/20 sm:text-xs"
                    defaultValue={String(field.defaultValue ?? "")}
                    id={`${question.id}-${field.key}`}
                    name={field.key}
                    required={field.required}
                  >
                    <option disabled value="">
                      Select an answer
                    </option>
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="mt-1.5 h-9 w-full rounded-[5px] border border-white/[.12] bg-black/20 px-2 text-base text-foreground outline-none placeholder:text-muted-foreground focus:border-[#ef9b7e]/60 focus:ring-2 focus:ring-[#ef9b7e]/20 sm:text-xs"
                    defaultValue={String(field.defaultValue ?? "")}
                    id={`${question.id}-${field.key}`}
                    name={field.key}
                    placeholder={field.placeholder}
                    required={field.required}
                    step={field.type === "integer" ? 1 : undefined}
                    type={
                      field.type === "number" || field.type === "integer"
                        ? "number"
                        : "text"
                    }
                  />
                )}
              </fieldset>
            ))}
          </div>
          <div className="mt-3 flex justify-end">
            <Button disabled={pending} size="sm" type="submit">
              {pending ? (
                <LoaderCircle className="animate-spin motion-reduce:animate-none" />
              ) : null}
              Answer agent
            </Button>
          </div>
        </div>
      </div>
    </form>
  )
}

function AgentThread({
  entries,
  permissionRequests,
  questions,
  queuedMessages,
  runtimeLimits,
  turnActive,
  turnInterrupted,
  activeTurnStartedAt,
  answeringQuestionId,
  replyingPermissionId,
  onPermissionReply,
  onAnswerQuestion,
  onCancelTurn,
  initialPrompt,
  onSubmitPrompt,
  promptDisabled,
  promptError,
  promptPending,
  cancelTurnPending,
  restartPending,
  onRestartWorkspace,
  workspaceError,
  models,
  skills,
  selectedModel,
  modelNotice,
  onModelChange,
}: {
  entries: ThreadEntry[]
  permissionRequests: ReadonlyArray<WorkspacePermissionRequest>
  questions: ReadonlyArray<WorkspaceQuestion>
  queuedMessages: ReadonlyArray<WorkspaceQueuedMessage>
  runtimeLimits?: WorkspaceRuntimeLimits
  turnActive: boolean
  turnInterrupted: boolean
  activeTurnStartedAt?: number | null
  answeringQuestionId?: string | null
  replyingPermissionId?: string | null
  onPermissionReply?: (
    requestId: string,
    reply: "once" | "always" | "reject"
  ) => Promise<void>
  onAnswerQuestion?: (
    questionId: string,
    answer: Record<string, WorkspaceQuestionValue>
  ) => Promise<void>
  onCancelTurn?: () => Promise<void>
  initialPrompt?: string
  onSubmitPrompt?: (
    text: string,
    model: { providerId: string; modelId: string }
  ) => Promise<void>
  promptDisabled?: boolean
  promptError?: string | null
  promptPending?: boolean
  cancelTurnPending?: boolean
  restartPending?: boolean
  onRestartWorkspace?: () => Promise<void>
  workspaceError?: string | null
  models: ReadonlyArray<ComposerModel>
  skills: ReadonlyArray<ComposerSkill>
  selectedModel?: { providerId: string; modelId: string } | null
  modelNotice?: string | null
  onModelChange?: (model: { providerId: string; modelId: string }) => void
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="mx-auto w-full max-w-3xl justify-end px-4 py-5 sm:px-7">
              {entries.map((entry) => (
                <MessageScrollerItem
                  key={entry.id}
                  messageId={entry.id}
                  className={cn(
                    "py-2 first:pt-0 last:pb-4",
                    entry.kind === "user" && "flex justify-end",
                    entry.kind === "tool" && "font-mono"
                  )}
                >
                  <article
                    className={cn(
                      "min-w-0",
                      entry.kind === "user"
                        ? "max-w-[85%] rounded-[18px] rounded-br-[6px] bg-white/[.07] px-4 py-2.5"
                        : "w-full"
                    )}
                  >
                    {(entry.title || entry.meta) && (
                      <div
                        className={cn(
                          "mb-1.5 flex items-center gap-2",
                          entry.kind === "user" && "hidden",
                          entry.kind === "agent" && !entry.title && "hidden"
                        )}
                      >
                        {entry.title && (
                          <h3 className="text-xs font-medium text-foreground/90">
                            {entry.title}
                          </h3>
                        )}
                        {entry.meta && (
                          <span className="text-[10px] text-muted-foreground">
                            {entry.meta}
                          </span>
                        )}
                      </div>
                    )}
                    {entry.kind === "agent" || entry.kind === "result" ? (
                      <ResponseMarkdown>{entry.body}</ResponseMarkdown>
                    ) : entry.kind === "user" ? (
                      <SkillInvocationMessage entry={entry} />
                    ) : (
                      <p
                        className={cn(
                          "text-[13px] leading-5 whitespace-pre-wrap",
                          "text-foreground/80"
                        )}
                      >
                        {entry.body}
                      </p>
                    )}
                    {entry.details && (
                      <ul className="mt-3 grid gap-1.5">
                        {entry.details.map((detail) => (
                          <li
                            key={detail}
                            className="flex items-center gap-2 text-[12px] text-muted-foreground"
                          >
                            <Check className="size-3 text-foreground/70" />
                            {detail}
                          </li>
                        ))}
                      </ul>
                    )}
                    {entry.artifact && (
                      <div className="mt-3 flex items-center gap-2 border border-white/[.09] bg-white/[.025] px-2.5 py-2">
                        <Activity className="size-3.5 text-[#ef9b7e]" />
                        <span className="text-[11px] font-medium">
                          {entry.artifact.label}
                        </span>
                        <span className="ml-auto truncate font-mono text-[9px] text-muted-foreground">
                          {entry.artifact.detail}
                        </span>
                      </div>
                    )}
                  </article>
                </MessageScrollerItem>
              ))}
              {permissionRequests.map((request) => {
                const pending = replyingPermissionId === request.id
                return (
                  <MessageScrollerItem
                    key={request.id}
                    messageId={request.id}
                    className="py-2 last:pb-4"
                  >
                    <article className="min-w-0 border border-[#ef9b7e]/30 bg-[#ef9b7e]/[.055] px-3.5 py-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#ef9b7e]" />
                        <div className="min-w-0 flex-1">
                          <h3 className="text-[13px] font-medium text-foreground">
                            Permission requested
                          </h3>
                          <p className="mt-1 text-[12px] leading-5 text-foreground/75">
                            {request.message ??
                              `The assistant wants to run ${request.action}.`}
                          </p>
                          <p
                            className="mt-2 truncate font-mono text-[11px] text-muted-foreground"
                            title={request.resources.join(", ")}
                          >
                            {request.resources.join(", ") || request.action}
                          </p>
                          <div className="mt-3 flex flex-wrap justify-end gap-2">
                            <Button
                              disabled={pending}
                              size="sm"
                              type="button"
                              variant="ghost"
                              onClick={() =>
                                onPermissionReply?.(request.id, "reject")
                              }
                            >
                              Reject
                            </Button>
                            {request.canSave ? (
                              <Button
                                disabled={pending}
                                size="sm"
                                type="button"
                                variant="outline"
                                onClick={() =>
                                  onPermissionReply?.(request.id, "always")
                                }
                              >
                                Always allow
                              </Button>
                            ) : null}
                            <Button
                              disabled={pending}
                              size="sm"
                              type="button"
                              onClick={() =>
                                onPermissionReply?.(request.id, "once")
                              }
                            >
                              {pending ? (
                                <LoaderCircle className="animate-spin" />
                              ) : null}
                              Allow once
                            </Button>
                          </div>
                        </div>
                      </div>
                    </article>
                  </MessageScrollerItem>
                )
              })}
              {questions.map((question) => (
                <MessageScrollerItem
                  className="py-2 last:pb-4"
                  key={question.id}
                  messageId={question.id}
                >
                  <AgentQuestion
                    onAnswer={onAnswerQuestion}
                    pending={answeringQuestionId === question.id}
                    question={question}
                  />
                </MessageScrollerItem>
              ))}
              {queuedMessages.map((message, index) => (
                <MessageScrollerItem
                  className="py-1 last:pb-4"
                  key={message.id}
                  messageId={message.id}
                >
                  <article className="flex min-w-0 items-start gap-2 border border-white/[.08] bg-white/[.025] px-3 py-2">
                    <MessagesSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] leading-4 break-words text-foreground/75">
                        {message.text}
                      </p>
                      <p className="mt-1 text-[9px] text-muted-foreground">
                        {message.delivery === "steer"
                          ? "Steering active Turn"
                          : `Queued ${index + 1} of ${runtimeLimits?.maxQueuedMessages ?? queuedMessages.length}`}
                      </p>
                    </div>
                  </article>
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      {workspaceError ? (
        <div className="mx-auto mb-3 flex w-[calc(100%-1.5rem)] max-w-3xl flex-col items-stretch gap-3 border border-destructive/25 bg-destructive/[.06] px-3 py-2.5 sm:flex-row sm:items-center">
          <CircleAlert className="size-4 shrink-0 text-destructive" />
          <p className="min-w-0 flex-1 text-[11px] text-foreground/80">
            {workspaceError}
          </p>
          {onRestartWorkspace ? (
            <Button
              className="self-end sm:self-auto"
              size="sm"
              type="button"
              variant="outline"
              disabled={restartPending}
              onClick={onRestartWorkspace}
            >
              {restartPending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              Restart
            </Button>
          ) : null}
        </div>
      ) : null}
      {turnInterrupted && !workspaceError ? (
        <div
          className="mx-auto mb-3 flex w-[calc(100%-1.5rem)] max-w-3xl items-start gap-2 border border-amber-400/25 bg-amber-400/[.055] px-3 py-2.5"
          role="status"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
          <p className="min-w-0 text-[11px] leading-4 text-foreground/80">
            The last Turn was interrupted. Files and Conversation history are
            safe. Send a new message to continue from the current Working copy.
          </p>
        </div>
      ) : null}
      {turnActive ? (
        <div
          className="mx-auto mb-2 flex w-[calc(100%-1.5rem)] max-w-3xl flex-wrap items-center gap-2 border border-white/[.09] bg-white/[.025] px-3 py-2"
          role="status"
        >
          <LoaderCircle className="size-3.5 animate-spin text-[#ef9b7e] motion-reduce:animate-none" />
          <span className="text-[11px] text-foreground/80">Agent working</span>
          <span className="font-mono text-[9px] text-muted-foreground">
            {runtimeLimits
              ? `${Math.round(runtimeLimits.maxTurnDurationMs / 60_000)} min limit · ${queuedMessages.length}/${runtimeLimits.maxQueuedMessages} queued`
              : "Turn active"}
          </span>
          {activeTurnStartedAt ? (
            <span className="hidden font-mono text-[9px] text-muted-foreground sm:inline">
              started {new Date(activeTurnStartedAt).toLocaleTimeString()}
            </span>
          ) : null}
          <Button
            className="ml-auto"
            disabled={cancelTurnPending}
            onClick={onCancelTurn}
            size="xs"
            type="button"
            variant="outline"
          >
            {cancelTurnPending ? (
              <LoaderCircle className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Square />
            )}
            Cancel Turn
          </Button>
        </div>
      ) : null}
      <PromptComposer
        disabled={promptDisabled}
        error={promptError}
        initialPrompt={initialPrompt}
        onSubmit={onSubmitPrompt}
        pending={promptPending}
        models={models}
        skills={skills}
        selectedModel={selectedModel}
        modelNotice={modelNotice}
        onModelChange={onModelChange}
        turnActive={turnActive}
        queueFull={
          runtimeLimits
            ? queuedMessages.length >= runtimeLimits.maxQueuedMessages
            : false
        }
      />
    </section>
  )
}

function ModelCombobox({
  disabled,
  models,
  selectedOption,
  onModelChange,
}: {
  disabled: boolean
  models: ReadonlyArray<ComposerModel>
  selectedOption: ComposerModel | null
  onModelChange?: (model: { providerId: string; modelId: string }) => void
}) {
  return (
    <SharedModelCombobox
      align="end"
      ariaLabel="Model for next turn"
      disabled={disabled}
      models={models}
      onValueChange={onModelChange}
      side="top"
      triggerClassName="ml-auto h-7 flex-1 rounded-[5px] border-white/[.12] bg-white/[.045] px-2 text-[11px] hover:bg-white/[.07] focus-visible:border-ring focus-visible:ring-ring/50"
      value={selectedOption}
    />
  )
}

function PromptComposer({
  disabled = false,
  error,
  initialPrompt = "",
  onSubmit,
  pending = false,
  models,
  skills,
  selectedModel,
  modelNotice,
  onModelChange,
  turnActive = false,
  queueFull = false,
}: {
  disabled?: boolean
  error?: string | null
  initialPrompt?: string
  onSubmit?: (
    text: string,
    model: { providerId: string; modelId: string },
    delivery?: "queue" | "steer"
  ) => Promise<void>
  pending?: boolean
  models: ReadonlyArray<ComposerModel>
  skills: ReadonlyArray<ComposerSkill>
  selectedModel?: { providerId: string; modelId: string } | null
  modelNotice?: string | null
  onModelChange?: (model: { providerId: string; modelId: string }) => void
  turnActive?: boolean
  queueFull?: boolean
}) {
  const [text, setText] = useState(initialPrompt)
  const [activeSkillIndex, setActiveSkillIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const commandQuery = /^\/([^\s]*)$/.exec(text)?.[1]?.toLocaleLowerCase()
  const matchingSkills =
    commandQuery === undefined
      ? []
      : skills.filter((skill) =>
          skill.name.toLocaleLowerCase().includes(commandQuery)
        )

  useEffect(() => setActiveSkillIndex(0), [commandQuery])

  const selectSkill = (skill: ComposerSkill) => {
    setText(`/${skill.name} `)
    textareaRef.current?.focus()
  }
  const selectedOption = selectedModel
    ? models.find(
        (model) =>
          model.providerId === selectedModel.providerId &&
          model.modelId === selectedModel.modelId
      )
    : null

  const submit = async (delivery?: "queue" | "steer") => {
    const prompt = text.trim()

    if (!prompt || disabled || pending || !onSubmit || !selectedModel) return
    if (delivery === "queue" && queueFull) return
    await onSubmit(prompt, selectedModel, delivery)
    setText("")
  }

  return (
    <div className="shrink-0 p-3 pt-0">
      <form
        className="@container relative mx-auto max-w-3xl border border-white/[.12] bg-[#1c1a18] shadow-[0_16px_45px_rgba(0,0,0,.24)] focus-within:border-[#ef9b7e]/45"
        onSubmit={async (event) => {
          event.preventDefault()
          await submit(turnActive ? "queue" : undefined)
        }}
      >
        {matchingSkills.length ? (
          <div
            aria-label="Skill commands"
            className="absolute inset-x-[-1px] bottom-[calc(100%+5px)] z-20 max-h-64 overflow-y-auto border border-white/[.12] bg-[#1c1a18] p-1 shadow-[0_16px_45px_rgba(0,0,0,.35)]"
            role="listbox"
          >
            {matchingSkills.map((skill, index) => (
              <button
                aria-selected={index === activeSkillIndex}
                className={cn(
                  "grid w-full grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-2 px-2 py-2 text-left outline-none hover:bg-white/[.07] focus-visible:bg-white/[.07]",
                  index === activeSkillIndex && "bg-white/[.07]"
                )}
                key={`${skill.scope}/${skill.name}`}
                onClick={() => selectSkill(skill)}
                role="option"
                type="button"
              >
                <Blocks className="mt-0.5 size-3.5 text-[#ef9b7e]" />
                <span className="min-w-0">
                  <span className="block font-mono text-[11px] text-foreground">
                    /{skill.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                    {skill.description}
                  </span>
                </span>
                <span className="pt-0.5 text-[9px] text-muted-foreground uppercase">
                  {skill.scope}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <Textarea
          aria-label="Message the agent"
          className="min-h-20 resize-none border-0 bg-transparent px-3 py-2.5 text-[13px] shadow-none focus-visible:ring-0"
          disabled={disabled || pending}
          ref={textareaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={async (event) => {
            if (matchingSkills.length && event.key === "ArrowDown") {
              event.preventDefault()
              setActiveSkillIndex((index) =>
                Math.min(index + 1, matchingSkills.length - 1)
              )
              return
            }
            if (matchingSkills.length && event.key === "ArrowUp") {
              event.preventDefault()
              setActiveSkillIndex((index) => Math.max(index - 1, 0))
              return
            }
            if (matchingSkills.length && event.key === "Enter") {
              event.preventDefault()
              const skill = matchingSkills[activeSkillIndex]
              if (skill) selectSkill(skill)
              return
            }
            if (matchingSkills.length && event.key === "Escape") {
              event.preventDefault()
              setText("")
              return
            }
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              await submit(turnActive ? "queue" : undefined)
            }
          }}
          placeholder={
            disabled
              ? "This Workspace is not accepting messages"
              : turnActive
                ? "Queue the next message or steer the active Turn"
                : "Ask OpenCode to create or change the Project"
          }
        />
        {error ? (
          <p role="alert" className="px-3 pb-2 text-[11px] text-destructive">
            {error}
          </p>
        ) : null}
        {modelNotice ? (
          <p className="border-t border-white/[.07] px-3 py-2 text-[11px] leading-4 break-words text-muted-foreground">
            {modelNotice}
          </p>
        ) : null}
        <div className="flex min-h-10 min-w-0 items-center gap-1 overflow-hidden border-t border-white/[.07] px-2 py-1">
          <Button aria-label="Attach file" size="icon-xs" variant="ghost">
            <Paperclip />
          </Button>
          <Button
            aria-label="Mention context"
            className="hidden @md:inline-flex"
            size="icon-xs"
            variant="ghost"
          >
            <AtSign />
          </Button>
          <Button
            aria-label="Open command"
            className="hidden @lg:inline-flex"
            size="icon-xs"
            variant="ghost"
            type="button"
            onClick={() => {
              setText("/")
              textareaRef.current?.focus()
            }}
          >
            <Terminal />
          </Button>
          <Button
            className="hidden @xl:inline-flex"
            size="xs"
            type="button"
            variant="ghost"
            onClick={() => {
              setText("/")
              textareaRef.current?.focus()
            }}
          >
            <Blocks /> Skills
          </Button>
          <ModelCombobox
            disabled={pending || turnActive || models.length === 0}
            models={models}
            selectedOption={selectedOption ?? null}
            onModelChange={onModelChange}
          />
          <span className="hidden text-[10px] whitespace-nowrap text-muted-foreground @2xl:inline">
            ⌘ ↵
          </span>
          {turnActive ? (
            <>
              <Button
                disabled={disabled || pending || !text.trim() || !selectedModel}
                onClick={() => void submit("steer")}
                size="xs"
                type="button"
                variant="outline"
              >
                <ArrowUp /> Steer
              </Button>
              <Button
                className="bg-[#ef9b7e] text-[#241613] hover:bg-[#f4af98]"
                disabled={
                  disabled ||
                  pending ||
                  queueFull ||
                  !text.trim() ||
                  !selectedModel
                }
                size="xs"
                type="submit"
              >
                {pending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <MessagesSquare />
                )}
                Queue
              </Button>
            </>
          ) : (
            <Button
              aria-label="Send message"
              className="bg-[#ef9b7e] text-[#241613] hover:bg-[#f4af98]"
              disabled={disabled || pending || !text.trim() || !selectedModel}
              size="icon-sm"
              type="submit"
            >
              {pending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <ArrowUp />
              )}
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}

function BrowserPreview({
  browser,
  content,
  onExpand,
  onRefresh,
  onRunTest,
}: {
  browser: BrowserState
  content?: ReactNode
  onExpand?: () => void
  onRefresh?: () => void
  onRunTest?: () => void
}) {
  const [url, setUrl] = useState(browser.url)
  const [viewportMode, setViewportMode] = useState<"responsive" | "mobile">(
    "mobile"
  )

  return (
    <section className="flex size-full min-h-0 flex-col bg-[#161513]">
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b px-2">
        <Button
          aria-label="Refresh preview"
          size="icon-xs"
          variant="ghost"
          onClick={onRefresh}
        >
          <RefreshCw />
        </Button>
        <form
          className="flex min-w-0 flex-1 items-center gap-2 rounded-[5px] border border-white/[.08] bg-black/20 px-2 py-1 focus-within:border-[#ef9b7e]/50 focus-within:ring-2 focus-within:ring-[#ef9b7e]/20"
          onSubmit={(event) => event.preventDefault()}
        >
          <Globe2 className="size-3 shrink-0 text-muted-foreground" />
          <input
            aria-label="Preview URL"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="min-w-0 flex-1 bg-transparent font-mono text-[10px] text-foreground/75 outline-none"
          />
        </form>
        <Button
          aria-label="Run browser test"
          size="icon-xs"
          variant="ghost"
          onClick={onRunTest}
        >
          <Play />
        </Button>
        <Button
          aria-label="Expand preview"
          size="icon-xs"
          variant="ghost"
          onClick={onExpand}
        >
          <Maximize2 />
        </Button>
        <span className="hidden font-mono text-[9px] text-muted-foreground lg:inline">
          {viewportMode === "mobile" ? "390px" : "Responsive"}
        </span>
        <Button
          aria-label="Responsive preview"
          aria-pressed={viewportMode === "responsive"}
          size="icon-xs"
          variant="ghost"
          onClick={() => setViewportMode("responsive")}
        >
          <Monitor />
        </Button>
        <Button
          aria-label="Mobile preview"
          aria-pressed={viewportMode === "mobile"}
          size="icon-xs"
          variant="ghost"
          onClick={() => setViewportMode("mobile")}
        >
          <Smartphone />
        </Button>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#161513] text-foreground">
        <div
          className={cn(
            "mx-auto h-full overflow-auto transition-[max-width] duration-200 motion-reduce:transition-none",
            viewportMode === "mobile" &&
              "max-w-[390px] border-x border-black/10"
          )}
        >
          {content ??
            (browser.status === "live" ? (
              <iframe
                className="size-full border-0 bg-white"
                referrerPolicy="no-referrer"
                sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
                src={browser.url}
                title={browser.title}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                <span className="mb-5 grid size-10 place-items-center rounded-[9px] border border-white/10 bg-white/[.05] text-[#ef9b7e] shadow-lg">
                  <SylphMark className="size-5" />
                </span>
                <h2 className="max-w-sm text-xl font-semibold tracking-[-0.03em] text-balance">
                  {browser.title}
                </h2>
                <p className="mt-2 max-w-sm text-xs leading-5 text-pretty text-muted-foreground">
                  {browser.status === "loading"
                    ? "Waiting for the workspace preview server."
                    : browser.status === "error"
                      ? "The preview could not be reached."
                      : "Connect a browser surface to begin verification."}
                </p>
              </div>
            ))}
        </div>
        <div className="absolute right-3 bottom-3 flex items-center gap-1.5 rounded-[4px] border border-black/10 bg-white/90 px-2 py-1 font-mono text-[9px] text-stone-700 shadow-sm backdrop-blur">
          <span className="size-1.5 rounded-full bg-emerald-500" /> 1440 × 900
        </div>
      </div>
    </section>
  )
}

function CheckList({ checks }: { checks: CheckItem[] }) {
  if (checks.length === 0) {
    return (
      <div className="grid min-h-36 place-items-center px-6 text-center">
        <p className="text-xs text-muted-foreground">
          No checks have run in this workspace.
        </p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-white/[.06]">
      {checks.map((check) => (
        <div key={check.name} className="px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            {check.status === "passed" && (
              <Check className="size-3.5 text-emerald-400" />
            )}
            {check.status === "running" && (
              <LoaderCircle className="size-3.5 animate-spin text-[#ef9b7e] motion-reduce:animate-none" />
            )}
            {check.status === "queued" && (
              <span className="size-3.5 rounded-full border border-muted-foreground/50" />
            )}
            {check.status === "failed" && (
              <X className="size-3.5 text-destructive" />
            )}
            <span className="text-xs font-medium">{check.name}</span>
            <span className="sr-only">{check.status}</span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              {check.detail}
            </span>
            {check.action ? (
              <Button
                disabled={check.action.disabled}
                onClick={check.action.onClick}
                size="xs"
                variant="outline"
              >
                {check.action.label}
              </Button>
            ) : null}
          </div>
          {check.output ? (
            <pre className="mt-2 max-h-48 overflow-auto border border-white/[.07] bg-black/20 p-2 font-mono text-[10px] leading-4 whitespace-pre-wrap text-muted-foreground">
              {check.output}
            </pre>
          ) : null}
          {check.evidence?.length ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {check.evidence.map((item) =>
                item.kind === "screenshot" ? (
                  <a
                    className="overflow-hidden border border-white/[.08] bg-black/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    href={item.url}
                    key={item.id}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <img
                      alt={item.label}
                      className="aspect-video w-full object-cover object-top"
                      src={item.url}
                    />
                    <span className="block px-2 py-1.5 text-[10px] text-muted-foreground">
                      {item.label}
                    </span>
                  </a>
                ) : (
                  <a
                    className="flex items-center gap-2 border border-white/[.08] bg-black/20 px-2 py-2 text-[10px] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    href={item.url}
                    key={item.id}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ShieldCheck className="size-3.5 text-[var(--sylph-live)]" />
                    {item.label}
                  </a>
                )
              )}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function ReviewSurface({
  patch,
  changeSummary = "No changes",
  changedFileCount = 0,
  checkpointHistory = [],
}: {
  patch?: string
  changeSummary?: string
  changedFileCount?: number
  checkpointHistory?: ReadonlyArray<{
    id: string
    commit: string
    message: string
    createdAt: number
  }>
}) {
  return (
    <section className="flex size-full min-h-0 flex-col bg-[var(--sylph-ink)]">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b bg-[#171614] px-3">
        <Files className="size-3.5 text-[#ef9b7e]" />
        <span className="text-xs font-medium">Working tree</span>
        <span className="font-mono text-[9px] text-emerald-400">
          {changeSummary}
        </span>
        <span className="ml-auto font-mono text-[9px] text-muted-foreground">
          {changedFileCount} {changedFileCount === 1 ? "file" : "files"}
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        {patch ? (
          <CodeReview className="h-full" patch={patch} />
        ) : (
          <div className="grid h-full place-items-center px-6 text-center">
            <p className="text-xs text-muted-foreground">
              The working tree has no changes.
            </p>
          </div>
        )}
      </div>
      {checkpointHistory.length ? (
        <div className="max-h-28 shrink-0 overflow-auto border-t bg-[#171614]">
          {checkpointHistory.map((checkpoint) => (
            <div
              className="flex items-center gap-2 border-b border-white/[.05] px-3 py-1.5 text-[10px] last:border-b-0"
              key={checkpoint.id}
            >
              <GitCommit className="size-3 text-[#ef9b7e]" />
              <span className="min-w-0 flex-1 truncate text-foreground/80">
                {checkpoint.message}
              </span>
              <span className="font-mono text-muted-foreground">
                {checkpoint.commit.slice(0, 7)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <footer className="flex h-9 shrink-0 items-center border-t px-3 text-[10px] text-muted-foreground">
        <span>
          {changedFileCount} {changedFileCount === 1 ? "file" : "files"} changed
        </span>
        <Button className="ml-auto" size="xs" variant="outline">
          Open in editor
        </Button>
      </footer>
    </section>
  )
}

function ChecksSurface({ checks }: { checks: CheckItem[] }) {
  return (
    <section className="size-full overflow-auto bg-background">
      <div className="mx-auto w-full max-w-4xl py-3">
        <CheckList checks={checks} />
      </div>
    </section>
  )
}

const reviewerInitials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase()

function ReviewerIdentity({
  actor,
  detail,
}: {
  actor: WorkspaceReviewActor
  detail?: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar size="sm">
        {actor.image ? <AvatarImage alt="" src={actor.image} /> : null}
        <AvatarFallback>{reviewerInitials(actor.name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium text-foreground">
          {actor.name}
        </p>
        {detail ? (
          <p className="truncate text-[9px] text-muted-foreground">{detail}</p>
        ) : null}
      </div>
    </div>
  )
}

function ReviewCommentCard({
  comment,
  pending,
  onResolve,
}: {
  comment: WorkspaceReviewComment
  pending: boolean
  onResolve?: (commentId: string, resolved: boolean) => Promise<void>
}) {
  const resolved = comment.resolvedAt !== null

  return (
    <article
      className={cn(
        "border border-white/[.09] bg-[#1a1917] text-left font-sans shadow-[0_5px_16px_rgba(0,0,0,.2)]",
        resolved && "opacity-65"
      )}
    >
      <header className="flex items-center gap-2 border-b border-white/[.07] px-2.5 py-2">
        <ReviewerIdentity actor={comment.author} />
        <span className="ml-auto font-mono text-[9px] text-muted-foreground">
          {comment.startLine === comment.endLine
            ? `L${comment.startLine}`
            : `L${comment.startLine}–${comment.endLine}`}
        </span>
      </header>
      <p className="px-2.5 py-2 text-[11px] leading-5 wrap-break-word whitespace-pre-wrap text-foreground/85">
        {comment.body}
      </p>
      <footer className="flex items-center gap-2 border-t border-white/[.06] px-2.5 py-1.5">
        <span
          className={cn(
            "text-[9px]",
            resolved ? "text-[var(--sylph-live)]" : "text-muted-foreground"
          )}
        >
          {resolved
            ? `Resolved${comment.resolvedBy ? ` by ${comment.resolvedBy.name}` : ""}`
            : "Open"}
        </span>
        <Button
          className="ml-auto h-6 px-2 text-[9px]"
          disabled={pending || !onResolve}
          onClick={() => void onResolve?.(comment.id, !resolved)}
          size="xs"
          variant="ghost"
        >
          {resolved ? <RotateCcw /> : <Check />}
          {resolved ? "Reopen" : "Resolve"}
        </Button>
      </footer>
    </article>
  )
}

function ReviewComposer({
  selection,
  pending,
  onCancel,
  onSubmit,
}: {
  selection: CodeReviewSelection
  pending: boolean
  onCancel: () => void
  onSubmit?: (comment: WorkspaceReviewCommentDraft) => Promise<boolean>
}) {
  const [body, setBody] = useState("")
  const side = selection.endSide ?? selection.side ?? "additions"
  const sameSide =
    !selection.side || !selection.endSide || selection.side === side
  const startLine = sameSide
    ? Math.min(selection.start, selection.end)
    : selection.end
  const endLine = sameSide
    ? Math.max(selection.start, selection.end)
    : selection.end

  return (
    <div className="border border-[var(--sylph-coral)]/35 bg-[#1a1917] p-2.5 font-sans shadow-[0_6px_20px_rgba(0,0,0,.28)]">
      <div className="mb-2 flex items-center gap-2 font-mono text-[9px] text-muted-foreground">
        <MessageCircle className="size-3 text-[var(--sylph-coral)]" />
        {selection.file} ·{" "}
        {startLine === endLine ? `L${startLine}` : `L${startLine}–${endLine}`}
      </div>
      <Textarea
        aria-label="Review comment"
        autoFocus
        className="min-h-20 resize-y bg-black/20 text-base md:text-xs"
        disabled={pending}
        maxLength={5_000}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Leave a clear, actionable comment"
        value={body}
      />
      <div className="mt-2 flex justify-end gap-1.5">
        <Button disabled={pending} onClick={onCancel} size="xs" variant="ghost">
          Cancel
        </Button>
        <Button
          disabled={pending || !body.trim() || !onSubmit}
          onClick={() =>
            void onSubmit?.({
              file: selection.file,
              side,
              startLine,
              endLine,
              body: body.trim(),
            }).then((saved) => {
              if (saved) onCancel()
            })
          }
          size="xs"
        >
          {pending ? (
            <LoaderCircle className="animate-spin motion-reduce:animate-none" />
          ) : (
            <MessageCircle />
          )}
          Add comment
        </Button>
      </div>
    </div>
  )
}

function ReviewNotesSurface({
  patch,
  review,
  currentReviewer,
  pending = false,
  error,
  onAddComment,
  onResolveComment,
  onSubmitReview,
}: {
  patch?: string
  review?: WorkspaceReview
  currentReviewer?: WorkspaceReviewActor
  pending?: boolean
  error?: string | null
  onAddComment?: (comment: WorkspaceReviewCommentDraft) => Promise<boolean>
  onResolveComment?: (commentId: string, resolved: boolean) => Promise<void>
  onSubmitReview?: (decision: "approved" | "changes_requested") => Promise<void>
}) {
  const [selectionState, setSelectionState] = useState<{
    commit: string
    selection: CodeReviewSelection
  } | null>(null)
  const selection =
    review && selectionState?.commit === review.commit
      ? selectionState.selection
      : null

  if (!patch || !review || !currentReviewer) {
    return (
      <section className="grid size-full place-items-center bg-background px-6 text-center">
        <div className="max-w-sm">
          <Check className="mx-auto mb-3 size-5 text-muted-foreground" />
          <h2 className="text-sm font-medium">No checkpoint to review</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Create a Checkpoint to comment on changed lines and submit a review.
          </p>
        </div>
      </section>
    )
  }

  const unresolvedComments = review.comments.filter(
    (comment) => comment.resolvedAt === null
  )
  const annotations: CodeReviewAnnotation[] = review.comments.map(
    (comment) => ({
      id: comment.id,
      file: comment.file,
      side: comment.side,
      lineNumber: comment.endLine,
    })
  )
  if (selection) {
    annotations.push({
      id: "review-composer",
      file: selection.file,
      side: selection.endSide ?? selection.side ?? "additions",
      lineNumber: selection.end,
    })
  }
  const decisionLabel = {
    pending: "Review pending",
    approved: "Approved",
    changes_requested: "Changes requested",
  }[review.decision]

  return (
    <section className="@container flex size-full min-h-0 flex-col bg-background">
      <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b bg-[#171614] px-3 py-1.5">
        {review.decision === "approved" ? (
          <BadgeCheck className="size-4 text-[var(--sylph-live)]" />
        ) : (
          <MessageCircle className="size-4 text-[var(--sylph-coral)]" />
        )}
        <div className="min-w-0">
          <h2 className="text-xs font-medium">
            Review {review.commit.slice(0, 7)}
          </h2>
          <p className="text-[9px] text-muted-foreground">
            Select changed lines or use + in the gutter to comment.
          </p>
        </div>
        <Badge
          className={cn(
            "ml-auto rounded-[4px] px-1.5 text-[9px]",
            review.decision === "approved" &&
              "border-[var(--sylph-live)]/30 text-[var(--sylph-live)]",
            review.decision === "changes_requested" &&
              "border-[var(--sylph-coral)]/40 text-[var(--sylph-coral)]"
          )}
          variant="outline"
        >
          {decisionLabel}
        </Badge>
      </header>
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(13rem,40%)] @2xl:grid-cols-[minmax(0,1fr)_17rem] @2xl:grid-rows-1">
        <CodeReview
          annotations={annotations}
          className="h-full min-h-0 border-b border-white/[.08] @2xl:border-r @2xl:border-b-0"
          onLineSelected={(nextSelection) =>
            setSelectionState(
              nextSelection
                ? { commit: review.commit, selection: nextSelection }
                : null
            )
          }
          patch={patch}
          renderAnnotation={(annotation) => {
            if (annotation.id === "review-composer" && selection) {
              return (
                <ReviewComposer
                  onCancel={() => setSelectionState(null)}
                  onSubmit={onAddComment}
                  pending={pending}
                  selection={selection}
                />
              )
            }
            const comment = review.comments.find(
              (candidate) => candidate.id === annotation.id
            )
            return comment ? (
              <ReviewCommentCard
                comment={comment}
                onResolve={onResolveComment}
                pending={pending}
              />
            ) : null
          }}
          selectedLines={selection}
        />
        <aside className="flex min-h-0 flex-col bg-[#171614]">
          <div className="border-b border-white/[.07] p-3">
            <ReviewerIdentity actor={currentReviewer} detail="Reviewing as" />
            {review.reviewer ? (
              <div className="mt-3 border-t border-white/[.06] pt-3">
                <ReviewerIdentity
                  actor={review.reviewer}
                  detail={`${decisionLabel}${
                    review.submittedAt
                      ? ` · ${new Intl.DateTimeFormat(undefined, {
                          month: "short",
                          day: "numeric",
                        }).format(review.submittedAt)}`
                      : ""
                  }`}
                />
              </div>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            <div className="mb-2 flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>{review.comments.length} comments</span>
              <span>·</span>
              <span>{unresolvedComments.length} open</span>
            </div>
            {review.comments.length ? (
              <div className="space-y-2">
                {review.comments.map((comment) => (
                  <div
                    className="border-b border-white/[.06] pb-2 text-[10px] last:border-b-0"
                    key={comment.id}
                  >
                    <p className="truncate font-mono text-[9px] text-[var(--sylph-coral)]">
                      {comment.file} · L{comment.startLine}
                    </p>
                    <p
                      className={cn(
                        "mt-1 line-clamp-2 leading-4 text-foreground/75",
                        comment.resolvedAt &&
                          "text-muted-foreground line-through"
                      )}
                    >
                      {comment.body}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[10px] leading-4 text-muted-foreground">
                No comments. Select a changed line when the review needs a note.
              </p>
            )}
          </div>
          <footer className="shrink-0 border-t border-white/[.08] p-3">
            {error ? (
              <p
                className="mb-2 text-[10px] leading-4 text-red-300"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            <Button
              className="w-full justify-center"
              disabled={pending || !onSubmitReview}
              onClick={() => void onSubmitReview?.("changes_requested")}
              size="sm"
              variant="outline"
            >
              {pending ? (
                <LoaderCircle className="animate-spin motion-reduce:animate-none" />
              ) : (
                <MessageCircle />
              )}
              Request changes
            </Button>
            <Button
              className="mt-1.5 w-full justify-center bg-[var(--sylph-live)] text-[#11100f] hover:bg-[var(--sylph-live)]/90"
              disabled={
                pending || unresolvedComments.length > 0 || !onSubmitReview
              }
              onClick={() => void onSubmitReview?.("approved")}
              size="sm"
              title={
                unresolvedComments.length
                  ? "Resolve all comments before approving"
                  : undefined
              }
            >
              {pending ? (
                <LoaderCircle className="animate-spin motion-reduce:animate-none" />
              ) : (
                <BadgeCheck />
              )}
              Approve
            </Button>
          </footer>
        </aside>
      </div>
    </section>
  )
}

function TerminalSurface() {
  return (
    <section className="flex size-full flex-col bg-[var(--sylph-ink)] font-mono text-[11px]">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3 text-muted-foreground">
        <Terminal className="size-3.5" />
        Cloudflare CI terminal
      </header>
      <div className="flex min-h-0 flex-1 items-start gap-2 p-4 text-muted-foreground">
        <span className="text-[var(--sylph-coral)]">$</span>
        <span>The terminal will attach when a Cloudflare CI run starts.</span>
        <span className="mt-0.5 h-3.5 w-1.5 animate-pulse bg-foreground/70 motion-reduce:animate-none" />
      </div>
    </section>
  )
}

const initialWorkspaceTabs: WorkspaceTab[] = []

const workspaceTabIcon = {
  browser: Globe2,
  changes: Files,
  checks: ListChecks,
  review: Check,
  terminal: Terminal,
} satisfies Record<WorkspaceTabKind, typeof MessageSquare>

function WorkspaceToolToggle({
  open,
  onToggle,
}: {
  open: boolean
  onToggle: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        aria-controls="workspace-tools"
        aria-expanded={open}
        aria-label={open ? "Hide tool sidebar" : "Open tool sidebar"}
        className={cn(
          "ml-auto grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          open && "bg-accent text-accent-foreground"
        )}
        onClick={onToggle}
      >
        {open ? (
          <PanelRightClose className="size-4" />
        ) : (
          <PanelRightOpen className="size-4" />
        )}
      </TooltipTrigger>
      <TooltipContent>{open ? "Hide tools" : "Open tools"}</TooltipContent>
    </Tooltip>
  )
}

function WorkspaceChat({
  entries,
  permissionRequests,
  questions,
  queuedMessages,
  runtimeLimits,
  turnActive,
  turnInterrupted,
  activeTurnStartedAt,
  answeringQuestionId,
  replyingPermissionId,
  onPermissionReply,
  onAnswerQuestion,
  onCancelTurn,
  initialPrompt,
  onToggleTools,
  onSubmitPrompt,
  onRestartWorkspace,
  promptDisabled,
  promptError,
  promptPending,
  cancelTurnPending,
  restartPending,
  toolPaneOpen,
  workspaceError,
  models,
  skills,
  selectedModel,
  modelNotice,
  onModelChange,
}: {
  entries: ThreadEntry[]
  permissionRequests: ReadonlyArray<WorkspacePermissionRequest>
  questions: ReadonlyArray<WorkspaceQuestion>
  queuedMessages: ReadonlyArray<WorkspaceQueuedMessage>
  runtimeLimits?: WorkspaceRuntimeLimits
  turnActive: boolean
  turnInterrupted: boolean
  activeTurnStartedAt?: number | null
  answeringQuestionId?: string | null
  replyingPermissionId?: string | null
  onPermissionReply?: (
    requestId: string,
    reply: "once" | "always" | "reject"
  ) => Promise<void>
  onAnswerQuestion?: (
    questionId: string,
    answer: Record<string, WorkspaceQuestionValue>
  ) => Promise<void>
  onCancelTurn?: () => Promise<void>
  initialPrompt?: string
  onToggleTools: () => void
  onSubmitPrompt?: (
    text: string,
    model: { providerId: string; modelId: string },
    delivery?: "queue" | "steer"
  ) => Promise<void>
  onRestartWorkspace?: () => Promise<void>
  promptDisabled?: boolean
  promptError?: string | null
  promptPending?: boolean
  cancelTurnPending?: boolean
  restartPending?: boolean
  toolPaneOpen: boolean
  workspaceError?: string | null
  models: ReadonlyArray<ComposerModel>
  skills: ReadonlyArray<ComposerSkill>
  selectedModel?: { providerId: string; modelId: string } | null
  modelNotice?: string | null
  onModelChange?: (model: { providerId: string; modelId: string }) => void
}) {
  return (
    <section
      aria-label="Workspace conversation"
      className="flex size-full min-w-0 flex-col bg-background"
    >
      <header className="flex h-10 shrink-0 items-center border-b px-3">
        <WorkspaceToolToggle open={toolPaneOpen} onToggle={onToggleTools} />
      </header>
      <AgentThread
        entries={entries}
        permissionRequests={permissionRequests}
        questions={questions}
        queuedMessages={queuedMessages}
        runtimeLimits={runtimeLimits}
        turnActive={turnActive}
        turnInterrupted={turnInterrupted}
        activeTurnStartedAt={activeTurnStartedAt}
        answeringQuestionId={answeringQuestionId}
        replyingPermissionId={replyingPermissionId}
        onPermissionReply={onPermissionReply}
        onAnswerQuestion={onAnswerQuestion}
        onCancelTurn={onCancelTurn}
        initialPrompt={initialPrompt}
        onSubmitPrompt={onSubmitPrompt}
        promptDisabled={promptDisabled}
        promptError={promptError}
        promptPending={promptPending}
        cancelTurnPending={cancelTurnPending}
        restartPending={restartPending}
        onRestartWorkspace={onRestartWorkspace}
        workspaceError={workspaceError}
        models={models}
        skills={skills}
        selectedModel={selectedModel}
        modelNotice={modelNotice}
        onModelChange={onModelChange}
      />
    </section>
  )
}

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
}: {
  activeTabId: string | null
  browser: BrowserState
  changedFileCount?: number
  checkpointHistory?: WorkspaceShellProps["checkpointHistory"]
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
}) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]
  const tools = [
    { kind: "browser", label: "New browser tab", icon: Globe2 },
    { kind: "changes", label: "Changes", icon: Files },
    { kind: "checks", label: "Checks", icon: ListChecks },
    { kind: "review", label: "Review", icon: Check },
    { kind: "terminal", label: "Terminal", icon: Terminal },
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
      </div>
    </div>
  )
}

function WorkspaceShell({
  workspaceId,
  canAdminister = false,
  organization = "Casey’s workspace",
  projectName,
  repositoryName,
  workspaceName,
  projects = fallbackProjects,
  entries = fallbackEntries,
  browser = {
    url: "http://127.0.0.1:3000/workspaces/preview",
    title: "Build, preview, and verify in one durable workspace.",
    status: "live",
  },
  checks = fallbackChecks,
  patch,
  changeSummary = "No changes",
  changedFileCount = 0,
  checkpointHistory = [],
  review,
  reviewPatch,
  currentReviewer,
  previewContent,
  agentControllingBrowser = false,
  demo = false,
  className,
  models = [],
  skills = [],
  selectedModel,
  modelNotice,
  onModelChange,
  initialPrompt,
  onSubmitPrompt,
  promptDisabled = false,
  pending = [],
  commandError,
  permissionRequests = [],
  questions = [],
  queuedMessages = [],
  runtimeLimits,
  turnActive = false,
  turnInterrupted = false,
  activeTurnStartedAt,
  onCheckpoint,
  onAccept,
  onAddReviewComment,
  onPermissionReply,
  onAnswerQuestion,
  onCancelTurn,
  onRestartWorkspace,
  onArchiveWorkspace,
  onDiscardWorkspace,
  onRebase,
  onResolveReviewComment,
  onSubmitReview,
  onOpenSearch,
  workspaceError,
}: WorkspaceShellProps) {
  const isPending = (command: WorkspaceCommandName) =>
    isWorkspaceCommandPending(pending, command)
  const checkpointPending = isPending("checkpoint")
  const acceptPending = isPending("accept")
  const restartPending = isPending("restart")
  const cancelTurnPending = isPending("cancelTurn")
  const archivePending = isPending("archive")
  const discardPending = isPending("discard")
  const rebasePending = isPending("rebase")
  const promptPending = isPending("prompt")
  const reviewPending = isPending("review")
  const answeringQuestionId = pendingWorkspaceCommandTarget(
    pending,
    "answerQuestion"
  )
  const replyingPermissionId = pendingWorkspaceCommandTarget(
    pending,
    "permissionReply"
  )
  const reviewError = workspaceCommandErrorMessage(commandError, "review")
  const promptError = workspaceCommandErrorExcept(commandError, "review")
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const [projectRailCollapsed, setProjectRailCollapsed] = useState(false)
  const [tabs, setTabs] = useState<WorkspaceTab[]>(initialWorkspaceTabs)
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [toolPaneOpen, setToolPaneOpen] = useState(false)
  const [toolPaneSize, setToolPaneSize] = useState(50)
  const [toolStateWorkspaceId, setToolStateWorkspaceId] = useState<
    string | null
  >(null)
  const browserTabNumber = useRef(0)
  const projectRailRef = useRef<PanelImperativeHandle>(null)
  const projectLayout = useDefaultLayout({
    id: "workspace-shell-navigation-v2",
    onlySaveAfterUserInteractions: true,
    panelIds: ["project-navigation", "workspace-area"],
    storage: workspacePanelStorage,
  })

  useEffect(() => {
    const restored = readWorkspaceToolState(workspacePanelStorage, workspaceId)
    const restoredTabs = restored?.tabs ?? initialWorkspaceTabs
    setTabs(restoredTabs)
    setActiveTabId(restored?.activeTabId ?? null)
    setToolPaneOpen(restored?.toolPaneOpen ?? false)
    setToolPaneSize(restored?.toolPaneSize ?? 50)
    browserTabNumber.current = restoredTabs.reduce((highest, tab) => {
      const match = /^browser-(\d+)$/.exec(tab.id)
      return match ? Math.max(highest, Number(match[1])) : highest
    }, 0)
    setToolStateWorkspaceId(workspaceId)
  }, [workspaceId])

  useEffect(() => {
    if (toolStateWorkspaceId !== workspaceId) return
    writeWorkspaceToolState(workspacePanelStorage, workspaceId, {
      tabs,
      activeTabId,
      toolPaneOpen,
      toolPaneSize,
    })
  }, [
    activeTabId,
    tabs,
    toolPaneOpen,
    toolPaneSize,
    toolStateWorkspaceId,
    workspaceId,
  ])

  const addBrowserTab = () => {
    browserTabNumber.current += 1
    const id = `browser-${browserTabNumber.current}`
    const tab: WorkspaceTab = {
      id,
      kind: "browser",
      label:
        browserTabNumber.current === 1
          ? "Browser"
          : `Browser ${browserTabNumber.current}`,
    }
    setTabs((current) => [...current, tab])
    setActiveTabId(id)
    setToolPaneOpen(true)
  }

  const openTool = (kind: WorkspaceTabKind) => {
    if (kind === "browser") {
      addBrowserTab()
      return
    }

    const existing = tabs.find((tab) => tab.kind === kind)

    if (existing) {
      setActiveTabId(existing.id)
      setToolPaneOpen(true)
      return
    }

    const labels = {
      changes: "Changes",
      checks: "Checks",
      review: "Review",
      terminal: "Terminal",
    } satisfies Record<Exclude<WorkspaceTabKind, "browser">, string>
    const tab: WorkspaceTab = { id: kind, kind, label: labels[kind] }
    setTabs((current) => [...current, tab])
    setActiveTabId(tab.id)
    setToolPaneOpen(true)
  }

  const closeTab = (tabId: string) => {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === tabId)
      const next = current.filter((tab) => tab.id !== tabId)

      if (activeTabId === tabId) {
        setActiveTabId(next[Math.max(0, index - 1)]?.id ?? null)
      }

      return next
    })
  }

  return (
    <TooltipProvider>
      <div
        className={cn(
          "dark relative flex h-svh min-h-[620px] overflow-hidden bg-background text-foreground",
          className
        )}
      >
        <UtilityRail
          canAdminister={canAdminister}
          onOpenSearch={onOpenSearch}
        />
        <ResizablePanelGroup
          className="min-w-0 flex-1 max-md:[&>#project-navigation]:hidden max-md:[&>#project-navigation-handle]:hidden"
          defaultLayout={projectLayout.defaultLayout}
          id="workspace-shell-navigation"
          onLayoutChanged={projectLayout.onLayoutChanged}
          orientation="horizontal"
        >
          <ResizablePanel
            collapsedSize={0}
            collapsible
            defaultSize="268px"
            groupResizeBehavior="preserve-pixel-size"
            id="project-navigation"
            maxSize="420px"
            minSize="220px"
            onResize={({ inPixels }) => setProjectRailCollapsed(inPixels === 0)}
            panelRef={projectRailRef}
          >
            <ProjectRail
              onClose={() => projectRailRef.current?.collapse()}
              organization={organization}
              projects={projects}
              workspaceName={workspaceName}
            />
          </ResizablePanel>
          <ResizableHandle
            aria-label="Resize project navigation"
            className="hidden transition-colors hover:bg-[var(--sylph-coral)]/50 md:flex"
            id="project-navigation-handle"
            withHandle
          />
          <ResizablePanel
            className="max-md:fixed! max-md:inset-1.5! max-md:w-auto! max-md:max-w-none! max-md:min-w-0! max-md:basis-auto!"
            id="workspace-area"
            minSize="480px"
          >
            <main className="flex size-full min-w-0 flex-col">
              <WorkspaceTopbar
                agentControllingBrowser={agentControllingBrowser}
                browser={browser}
                checks={checks}
                demo={demo}
                navigationCollapsed={projectRailCollapsed}
                onOpenNavigation={() => {
                  if (projectRailCollapsed) {
                    projectRailRef.current?.expand()
                    return
                  }
                  setMobileNavigationOpen(true)
                }}
                onOpenTerminal={() => openTool("terminal")}
                onCheckpoint={onCheckpoint}
                checkpointDisabled={changedFileCount === 0 || !onCheckpoint}
                checkpointPending={checkpointPending}
                onAccept={onAccept}
                acceptDisabled={
                  changedFileCount > 0 || !onAccept || checkpointPending
                }
                acceptPending={acceptPending}
                onRestartWorkspace={onRestartWorkspace}
                restartPending={restartPending}
                onArchiveWorkspace={onArchiveWorkspace}
                archivePending={archivePending}
                onDiscardWorkspace={onDiscardWorkspace}
                discardPending={discardPending}
                onRebase={onRebase}
                rebasePending={rebasePending}
                projectName={projectName}
                repositoryName={repositoryName}
                workspaceName={workspaceName}
              />
              {mobileNavigationOpen && (
                <div
                  className="absolute inset-0 z-50 flex bg-black/60 md:hidden"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setMobileNavigationOpen(false)
                  }}
                >
                  <ProjectRail
                    mobile
                    onClose={() => setMobileNavigationOpen(false)}
                    organization={organization}
                    projects={projects}
                    workspaceName={workspaceName}
                  />
                  <button
                    aria-label="Dismiss navigation"
                    className="min-w-0 flex-1"
                    type="button"
                    onClick={() => setMobileNavigationOpen(false)}
                  />
                </div>
              )}
              <ResizablePanelGroup
                className="relative min-h-0 flex-1"
                id="workspace-content-panes"
                onLayoutChanged={(layout, meta) => {
                  const size = layout["workspace-tools"]
                  if (
                    meta.isUserInteraction &&
                    size !== undefined &&
                    Number.isFinite(size)
                  ) {
                    setToolPaneSize(size)
                  }
                }}
                orientation="horizontal"
              >
                <ResizablePanel id="workspace-chat" minSize="260px">
                  <WorkspaceChat
                    entries={entries}
                    permissionRequests={permissionRequests}
                    questions={questions}
                    queuedMessages={queuedMessages}
                    runtimeLimits={runtimeLimits}
                    turnActive={turnActive}
                    turnInterrupted={turnInterrupted}
                    activeTurnStartedAt={activeTurnStartedAt}
                    answeringQuestionId={answeringQuestionId}
                    replyingPermissionId={replyingPermissionId}
                    onPermissionReply={onPermissionReply}
                    onAnswerQuestion={onAnswerQuestion}
                    onCancelTurn={onCancelTurn}
                    initialPrompt={initialPrompt}
                    models={models}
                    skills={skills}
                    selectedModel={selectedModel}
                    modelNotice={modelNotice}
                    onModelChange={onModelChange}
                    onToggleTools={() => setToolPaneOpen((open) => !open)}
                    onSubmitPrompt={onSubmitPrompt}
                    promptDisabled={promptDisabled}
                    promptError={promptError}
                    promptPending={promptPending}
                    cancelTurnPending={cancelTurnPending}
                    restartPending={restartPending}
                    toolPaneOpen={toolPaneOpen}
                    onRestartWorkspace={onRestartWorkspace}
                    workspaceError={workspaceError}
                  />
                </ResizablePanel>
                {toolPaneOpen ? (
                  <>
                    <ResizableHandle
                      aria-label="Resize workspace tool pane"
                      className="hidden transition-colors hover:bg-[var(--sylph-coral)]/50 md:flex"
                      id="workspace-tool-handle"
                      withHandle
                    />
                    <ResizablePanel
                      className="bg-background max-md:fixed! max-md:inset-x-1.5! max-md:top-[54px]! max-md:bottom-1.5! max-md:z-50 max-md:h-auto! max-md:w-auto! max-md:max-w-none! max-md:min-w-0! max-md:basis-auto!"
                      defaultSize={`${toolPaneSize}%`}
                      id="workspace-tools"
                      maxSize="70%"
                      minSize="260px"
                    >
                      <WorkspaceTabs
                        activeTabId={activeTabId}
                        browser={browser}
                        changedFileCount={changedFileCount}
                        changeSummary={changeSummary}
                        checkpointHistory={checkpointHistory}
                        checks={checks}
                        onActivateTab={setActiveTabId}
                        onCloseTab={closeTab}
                        onDismiss={() => setToolPaneOpen(false)}
                        onOpenTool={openTool}
                        onAddReviewComment={onAddReviewComment}
                        onResolveReviewComment={onResolveReviewComment}
                        onSubmitReview={onSubmitReview}
                        patch={patch}
                        previewContent={previewContent}
                        review={review}
                        reviewPatch={reviewPatch}
                        currentReviewer={currentReviewer}
                        reviewPending={reviewPending}
                        reviewError={reviewError}
                        tabs={tabs}
                      />
                    </ResizablePanel>
                  </>
                ) : null}
              </ResizablePanelGroup>
            </main>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </TooltipProvider>
  )
}

export {
  AgentThread,
  BrowserPreview,
  CheckList,
  ProjectRail,
  ReviewNotesSurface,
  ReviewSurface,
  WorkspaceTabs,
  WorkspaceShell,
  WorkspaceTopbar,
  fallbackChecks,
  fallbackEntries,
  fallbackProjects,
}
export type {
  BrowserState,
  CheckItem,
  ProjectGroup,
  ThreadEntry,
  WorkspaceReview,
  WorkspaceReviewActor,
  WorkspaceReviewComment,
  WorkspaceReviewCommentDraft,
  WorkspaceQuestion,
  WorkspaceQuestionValue,
  WorkspaceQueuedMessage,
  WorkspaceRuntimeLimits,
  WorkspacePermissionRequest,
  WorkspaceItem,
  WorkspaceShellProps,
  WorkspaceTab,
  WorkspaceTabKind,
}
