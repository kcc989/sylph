"use client"

import {
  Activity,
  ArrowUp,
  Bell,
  Blocks,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Files,
  FolderGit2,
  GitBranch,
  Globe2,
  House,
  LoaderCircle,
  ListChecks,
  Maximize2,
  MessageSquare,
  Monitor,
  MoreHorizontal,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Smartphone,
  Terminal,
  AtSign,
  UserRound,
  X,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import { useRef, useState, type ReactNode } from "react"
import {
  useDefaultLayout,
  type PanelImperativeHandle,
} from "react-resizable-panels"
import remarkGfm from "remark-gfm"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { CodeReview } from "@workspace/ui/components/code-review"
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

type WorkspaceStatus = "running" | "waiting" | "ready" | "error"

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
  branch: string
  status: WorkspaceStatus
  changes?: string
}

type ProjectGroup = {
  id: string
  name: string
  repositoryName: string
  newWorkspaceHref?: string
  settingsHref?: string
  workspaces: WorkspaceItem[]
}

type ThreadEntry = {
  id: string
  kind: "user" | "agent" | "tool" | "result"
  title?: string
  body: string
  meta?: string
  details?: string[]
  artifact?: { label: string; detail: string }
}

type BrowserState = {
  url: string
  title: string
  status: "live" | "loading" | "error"
}

type CheckItem = {
  name: string
  detail: string
  status: "passed" | "running" | "failed"
}

type WorkspaceTabKind = "browser" | "changes" | "checks" | "review" | "terminal"

type WorkspaceTab = {
  id: string
  kind: WorkspaceTabKind
  label: string
}

type WorkspaceShellProps = {
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
  previewContent?: ReactNode
  agentControllingBrowser?: boolean
  demo?: boolean
  className?: string
  model?: string | null
  promptDisabled?: boolean
  promptError?: string | null
  promptPending?: boolean
  restartPending?: boolean
  onSubmitPrompt?: (text: string) => Promise<void>
  onRestartWorkspace?: () => Promise<void>
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

const statusStyles = {
  running:
    "text-[var(--sylph-live)] drop-shadow-[0_0_4px_color-mix(in_oklch,var(--sylph-live)_35%,transparent)]",
  waiting: "text-amber-400",
  ready: "text-muted-foreground",
  error: "text-destructive",
} satisfies Record<WorkspaceStatus, string>

function UtilityRail() {
  const items = [
    { label: "Home", icon: House },
    { label: "Search", icon: Search },
    { label: "Files", icon: Files },
    { label: "Skills", icon: Blocks },
  ]

  return (
    <aside
      aria-label="Product navigation"
      className="hidden w-12 shrink-0 flex-col items-center border-r bg-[var(--sylph-ink)] py-2.5 md:flex"
    >
      <div
        aria-label="Sylph"
        role="img"
        className="mb-4 grid size-7 place-items-center rounded-[6px] border border-white/10 bg-[#f0a087] text-[#241613]"
      >
        <SylphMark className="size-4" />
      </div>
      <nav className="grid gap-1" aria-label="Workspace tools">
        {items.map(({ label, icon: Icon }, index) => (
          <Tooltip key={label}>
            <TooltipTrigger
              aria-label={label}
              className={cn(
                "grid size-8 place-items-center rounded-[6px] text-muted-foreground transition-colors hover:bg-white/[.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                index === 0 && "bg-white/[.07] text-foreground"
              )}
            >
              <Icon className="size-4" />
            </TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ))}
      </nav>
      <div className="mt-auto grid gap-1">
        <Button aria-label="Theme" size="icon-sm" variant="ghost">
          <Moon />
        </Button>
        <Button aria-label="Notifications" size="icon-sm" variant="ghost">
          <Bell />
        </Button>
        <Button aria-label="Settings" size="icon-sm" variant="ghost">
          <Settings2 />
        </Button>
        <div className="grid size-7 place-items-center rounded-full border border-white/10 bg-white/[.06]">
          <UserRound className="size-3.5 text-muted-foreground" />
        </div>
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
        "h-full shrink-0 flex-col bg-sidebar",
        mobile ? "flex w-[268px] border-r" : "hidden w-full md:flex"
      )}
    >
      <header className="flex h-12 items-center gap-2 border-b px-3">
        <div className="grid size-6 place-items-center rounded-[5px] bg-foreground text-[10px] font-bold text-background">
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
      <div className="flex h-10 items-center justify-between px-3">
        <span className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Projects
        </span>
        <Button aria-label="Add project" size="icon-xs" variant="ghost">
          <Plus />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1 px-2 pb-3">
        <div className="grid gap-3">
          {projects.map((project) => (
            <section key={project.id}>
              <div className="flex h-9 items-center gap-2 px-2 text-xs font-semibold text-foreground/85">
                <FolderGit2 className="size-3.5 text-[#ef9b7e]" />
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                <Button
                  aria-label={`New workspace in ${project.name}`}
                  disabled={!project.newWorkspaceHref}
                  nativeButton={!project.newWorkspaceHref}
                  render={
                    project.newWorkspaceHref ? (
                      <a href={project.newWorkspaceHref} />
                    ) : undefined
                  }
                  size="icon-xs"
                  variant="ghost"
                >
                  <Plus />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={`Open ${project.name} menu`}
                    className="grid size-6 place-items-center rounded-[4px] text-muted-foreground hover:bg-white/[.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <MoreHorizontal className="size-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                      disabled={!project.newWorkspaceHref}
                      onClick={() => {
                        if (project.newWorkspaceHref) {
                          window.location.assign(project.newWorkspaceHref)
                        }
                      }}
                    >
                      <Plus /> New Workspace
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
              <div className="grid gap-0.5 pr-1 pl-4">
                {project.workspaces.map((workspace) => {
                  const active = workspace.name === workspaceName
                  const label =
                    workspace.name === project.name
                      ? workspace.branch
                      : workspace.name
                  return (
                    <button
                      key={workspace.id}
                      type="button"
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group flex h-8 w-full items-center gap-2 rounded-[5px] px-2 text-left transition-colors hover:bg-white/[.045] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                        active && "bg-white/[.065]"
                      )}
                    >
                      <GitBranch
                        aria-label={`${workspace.status} workspace`}
                        className={cn(
                          "size-3.5 shrink-0",
                          statusStyles[workspace.status]
                        )}
                      />
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
                    </button>
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
}) {
  const passedChecks = checks.filter(
    (check) => check.status === "passed"
  ).length

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
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
      <FolderGit2 className="size-4 text-[#ef9b7e]" />
      <span className="hidden text-xs text-muted-foreground sm:inline">
        {projectName}
      </span>
      <ChevronRight className="hidden size-3 text-muted-foreground/50 sm:block" />
      <span className="min-w-0 truncate text-xs font-medium">
        {workspaceName}
      </span>
      <span className="hidden font-mono text-[9px] text-muted-foreground lg:inline">
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
        <div className="mr-1 hidden items-center gap-2 xl:flex">
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
        <Button size="sm" variant="ghost" onClick={onOpenTerminal}>
          <Terminal /> Terminal
        </Button>
        <Button size="sm" variant="outline">
          <GitBranch /> Create PR
        </Button>
        <Button
          aria-label="More workspace actions"
          size="icon-sm"
          variant="ghost"
        >
          <MoreHorizontal />
        </Button>
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

function AgentThread({
  entries,
  onSubmitPrompt,
  promptDisabled,
  promptError,
  promptPending,
  restartPending,
  onRestartWorkspace,
  workspaceError,
}: {
  entries: ThreadEntry[]
  onSubmitPrompt?: (text: string) => Promise<void>
  promptDisabled?: boolean
  promptError?: string | null
  promptPending?: boolean
  restartPending?: boolean
  onRestartWorkspace?: () => Promise<void>
  workspaceError?: string | null
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
                    ) : (
                      <p
                        className={cn(
                          "text-[13px] leading-5 whitespace-pre-wrap",
                          entry.kind === "user"
                            ? "text-foreground"
                            : "text-foreground/80"
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
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      {workspaceError ? (
        <div className="mx-auto mb-3 flex w-[calc(100%-1.5rem)] max-w-3xl items-center gap-3 border border-destructive/25 bg-destructive/[.06] px-3 py-2.5">
          <CircleAlert className="size-4 shrink-0 text-destructive" />
          <p className="min-w-0 flex-1 text-[11px] text-foreground/80">
            {workspaceError}
          </p>
          {onRestartWorkspace ? (
            <Button
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
      <PromptComposer
        disabled={promptDisabled}
        error={promptError}
        onSubmit={onSubmitPrompt}
        pending={promptPending}
      />
    </section>
  )
}

function PromptComposer({
  disabled = false,
  error,
  onSubmit,
  pending = false,
}: {
  disabled?: boolean
  error?: string | null
  onSubmit?: (text: string) => Promise<void>
  pending?: boolean
}) {
  const [text, setText] = useState("")

  const submit = async () => {
    const prompt = text.trim()

    if (!prompt || disabled || pending || !onSubmit) return
    await onSubmit(prompt)
    setText("")
  }

  return (
    <div className="shrink-0 p-3 pt-0">
      <form
        className="mx-auto max-w-3xl border border-white/[.12] bg-[#1c1a18] shadow-[0_16px_45px_rgba(0,0,0,.24)] focus-within:border-[#ef9b7e]/45"
        onSubmit={async (event) => {
          event.preventDefault()
          await submit()
        }}
      >
        <Textarea
          aria-label="Message the agent"
          className="min-h-20 resize-none border-0 bg-transparent px-3 py-2.5 text-[13px] shadow-none focus-visible:ring-0"
          disabled={disabled || pending}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={async (event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              await submit()
            }
          }}
          placeholder={
            disabled
              ? "OpenCode is still provisioning this Workspace"
              : "Ask OpenCode to create or change the Project"
          }
        />
        {error ? (
          <p role="alert" className="px-3 pb-2 text-[11px] text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex h-9 items-center gap-1 border-t border-white/[.07] px-2">
          <Button aria-label="Attach file" size="icon-xs" variant="ghost">
            <Paperclip />
          </Button>
          <Button aria-label="Mention context" size="icon-xs" variant="ghost">
            <AtSign />
          </Button>
          <Button aria-label="Open command" size="icon-xs" variant="ghost">
            <Terminal />
          </Button>
          <Button size="xs" variant="ghost">
            <Blocks /> Skills
          </Button>
          <Button className="ml-auto" size="xs" variant="ghost">
            Agent <ChevronDown />
          </Button>
          <span className="text-[10px] text-muted-foreground">⌘ ↵</span>
          <Button
            aria-label="Send message"
            className="bg-[#ef9b7e] text-[#241613] hover:bg-[#f4af98]"
            disabled={disabled || pending || !text.trim()}
            size="icon-sm"
            type="submit"
          >
            {pending ? <LoaderCircle className="animate-spin" /> : <ArrowUp />}
          </Button>
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
          {content ?? (
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
          )}
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
        <div key={check.name} className="flex items-center gap-2.5 px-3 py-2.5">
          {check.status === "passed" && (
            <Check className="size-3.5 text-emerald-400" />
          )}
          {check.status === "running" && (
            <LoaderCircle className="size-3.5 animate-spin text-[#ef9b7e] motion-reduce:animate-none" />
          )}
          {check.status === "failed" && (
            <X className="size-3.5 text-destructive" />
          )}
          <span className="text-xs font-medium">{check.name}</span>
          <span className="sr-only">{check.status}</span>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            {check.detail}
          </span>
        </div>
      ))}
    </div>
  )
}

function ReviewSurface({
  patch,
  changeSummary = "No changes",
  changedFileCount = 0,
}: {
  patch?: string
  changeSummary?: string
  changedFileCount?: number
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

function ReviewNotesSurface() {
  return (
    <section className="grid size-full place-items-center bg-background px-6 text-center">
      <div className="max-w-sm">
        <Check className="mx-auto mb-3 size-5 text-muted-foreground" />
        <h2 className="text-sm font-medium">No review notes yet</h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Select changed lines to leave notes or hand the change to your editor.
        </p>
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

function WorkspaceToolLauncher({
  activeTab,
  onOpenTool,
}: {
  activeTab?: WorkspaceTab
  onOpenTool: (kind: WorkspaceTabKind) => void
}) {
  const tools = [
    { kind: "browser", label: "Browser", icon: Globe2 },
    { kind: "changes", label: "Changes", icon: Files },
    { kind: "checks", label: "Checks", icon: ListChecks },
    { kind: "review", label: "Review", icon: Check },
  ] satisfies Array<{
    kind: WorkspaceTabKind
    label: string
    icon: typeof Globe2
  }>

  return (
    <div className="ml-auto flex items-center gap-0.5">
      {tools.map((tool) => {
        const active = activeTab?.kind === tool.kind
        const Icon = tool.icon
        return (
          <Tooltip key={tool.kind}>
            <TooltipTrigger
              aria-label={`Open ${tool.label} window`}
              aria-pressed={active}
              className={cn(
                "grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                active && "bg-accent text-accent-foreground"
              )}
              onClick={() => onOpenTool(tool.kind)}
            >
              <Icon className="size-4" />
            </TooltipTrigger>
            <TooltipContent>{tool.label}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

function WorkspaceChat({
  activeTab,
  entries,
  model,
  onOpenTool,
  onSubmitPrompt,
  onRestartWorkspace,
  promptDisabled,
  promptError,
  promptPending,
  restartPending,
  workspaceError,
}: {
  activeTab?: WorkspaceTab
  entries: ThreadEntry[]
  model?: string | null
  onOpenTool: (kind: WorkspaceTabKind) => void
  onSubmitPrompt?: (text: string) => Promise<void>
  onRestartWorkspace?: () => Promise<void>
  promptDisabled?: boolean
  promptError?: string | null
  promptPending?: boolean
  restartPending?: boolean
  workspaceError?: string | null
}) {
  return (
    <section className="flex size-full min-w-0 flex-col bg-background">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <MessageSquare className="size-3.5 text-[#ef9b7e]" />
        <h1 className="text-xs font-medium">Chat</h1>
        <Badge
          className="hidden rounded-[4px] px-1.5 font-mono text-[9px] sm:inline-flex"
          variant="outline"
        >
          {model ?? "OpenCode v2"}
        </Badge>
        <WorkspaceToolLauncher activeTab={activeTab} onOpenTool={onOpenTool} />
      </header>
      <AgentThread
        entries={entries}
        onSubmitPrompt={onSubmitPrompt}
        promptDisabled={promptDisabled}
        promptError={promptError}
        promptPending={promptPending}
        restartPending={restartPending}
        onRestartWorkspace={onRestartWorkspace}
        workspaceError={workspaceError}
      />
    </section>
  )
}

function WorkspaceTabs({
  activeTabId,
  browser,
  changedFileCount,
  changeSummary,
  checks,
  onActivateTab,
  onAddBrowser,
  onCloseTab,
  onDismiss,
  patch,
  previewContent,
  tabs,
}: {
  activeTabId: string
  browser: BrowserState
  changedFileCount?: number
  changeSummary?: string
  checks: CheckItem[]
  onActivateTab: (tabId: string) => void
  onAddBrowser: () => void
  onCloseTab: (tabId: string) => void
  onDismiss: () => void
  patch?: string
  previewContent?: ReactNode
  tabs: WorkspaceTab[]
}) {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]

  if (!activeTab) return null

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
                  aria-controls={`workspace-panel-${tab.id}`}
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
          <Button
            aria-label="New browser tab"
            className="m-1 shrink-0"
            onClick={onAddBrowser}
            size="icon-xs"
            variant="ghost"
          >
            <Plus />
          </Button>
        </div>
        <Button
          aria-label="Return to Chat"
          className="m-1 md:hidden"
          onClick={onDismiss}
          size="icon-xs"
          variant="ghost"
        >
          <MessageSquare />
        </Button>
      </div>
      <div
        aria-labelledby={`workspace-tab-${activeTab.id}`}
        className="flex min-h-0 flex-1 flex-col"
        id={`workspace-panel-${activeTab.id}`}
        role="tabpanel"
      >
        {activeTab.kind === "browser" ? (
          <BrowserPreview browser={browser} content={previewContent} />
        ) : null}
        {activeTab.kind === "changes" ? (
          <ReviewSurface
            changedFileCount={changedFileCount}
            changeSummary={changeSummary}
            patch={patch}
          />
        ) : null}
        {activeTab.kind === "checks" ? <ChecksSurface checks={checks} /> : null}
        {activeTab.kind === "review" ? <ReviewNotesSurface /> : null}
        {activeTab.kind === "terminal" ? <TerminalSurface /> : null}
      </div>
    </div>
  )
}

function WorkspaceShell({
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
  previewContent,
  agentControllingBrowser = false,
  demo = false,
  className,
  model,
  onSubmitPrompt,
  promptDisabled = false,
  promptError,
  promptPending = false,
  restartPending = false,
  onRestartWorkspace,
  workspaceError,
}: WorkspaceShellProps) {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const [projectRailCollapsed, setProjectRailCollapsed] = useState(false)
  const [tabs, setTabs] = useState<WorkspaceTab[]>(initialWorkspaceTabs)
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const browserTabNumber = useRef(0)
  const projectRailRef = useRef<PanelImperativeHandle>(null)
  const projectLayout = useDefaultLayout({
    id: "workspace-shell-navigation-v2",
    onlySaveAfterUserInteractions: true,
    panelIds: ["project-navigation", "workspace-area"],
    storage: workspacePanelStorage,
  })

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
  }

  const openTool = (kind: WorkspaceTabKind) => {
    const existing = tabs.find((tab) => tab.kind === kind)

    if (existing) {
      setActiveTabId(existing.id)
      return
    }

    if (kind === "browser") {
      addBrowserTab()
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

  const activeTab = tabs.find((tab) => tab.id === activeTabId)

  return (
    <TooltipProvider>
      <div
        className={cn(
          "dark relative m-1.5 flex h-[calc(100svh-0.75rem)] min-h-[620px] overflow-hidden rounded-[10px] border bg-background text-foreground shadow-[0_22px_70px_rgba(0,0,0,.38)]",
          className
        )}
      >
        <UtilityRail />
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
                orientation="horizontal"
              >
                <ResizablePanel id="workspace-chat" minSize="260px">
                  <WorkspaceChat
                    activeTab={activeTab}
                    entries={entries}
                    model={model}
                    onOpenTool={openTool}
                    onSubmitPrompt={onSubmitPrompt}
                    promptDisabled={promptDisabled}
                    promptError={promptError}
                    promptPending={promptPending}
                    restartPending={restartPending}
                    onRestartWorkspace={onRestartWorkspace}
                    workspaceError={workspaceError}
                  />
                </ResizablePanel>
                {activeTab ? (
                  <>
                    <ResizableHandle
                      aria-label="Resize workspace tool pane"
                      className="hidden transition-colors hover:bg-[var(--sylph-coral)]/50 md:flex"
                      id="workspace-tool-handle"
                      withHandle
                    />
                    <ResizablePanel
                      className="bg-background max-md:fixed! max-md:inset-x-1.5! max-md:top-[54px]! max-md:bottom-1.5! max-md:z-50 max-md:h-auto! max-md:w-auto! max-md:max-w-none! max-md:min-w-0! max-md:basis-auto!"
                      defaultSize="50%"
                      id="workspace-tools"
                      maxSize="70%"
                      minSize="260px"
                    >
                      <WorkspaceTabs
                        activeTabId={activeTab.id}
                        browser={browser}
                        changedFileCount={changedFileCount}
                        changeSummary={changeSummary}
                        checks={checks}
                        onActivateTab={setActiveTabId}
                        onAddBrowser={addBrowserTab}
                        onCloseTab={closeTab}
                        onDismiss={() => setActiveTabId(null)}
                        patch={patch}
                        previewContent={previewContent}
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
  WorkspaceItem,
  WorkspaceShellProps,
  WorkspaceTab,
  WorkspaceTabKind,
}
