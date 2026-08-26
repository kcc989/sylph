"use client"

import {
  Activity,
  ArrowUp,
  Bot,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  Files,
  FolderGit2,
  GitBranch,
  Globe2,
  House,
  LoaderCircle,
  Maximize2,
  Monitor,
  MoreHorizontal,
  Moon,
  PanelLeftClose,
  Paperclip,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Smartphone,
  Terminal,
  AtSign,
  UserRound,
  Wrench,
  X,
} from "lucide-react"
import { useState, type ReactNode } from "react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { CodeReview } from "@workspace/ui/components/code-review"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"

type WorkspaceStatus = "running" | "waiting" | "ready" | "error"

type WorkspaceItem = {
  id: string
  name: string
  branch: string
  status: WorkspaceStatus
  changes?: string
}

type RepositoryGroup = {
  id: string
  name: string
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

type WorkspaceShellProps = {
  organization?: string
  repositoryName: string
  workspaceName: string
  repositories?: RepositoryGroup[]
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

const fallbackRepositories: RepositoryGroup[] = [
  {
    id: "sylph",
    name: "sylph",
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
    name: "open-relic",
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
    body: "Make the workspace preview persistent and let the agent verify the responsive states.",
    meta: "You · 10:24",
  },
  {
    id: "inspect",
    kind: "tool",
    title: "Plan",
    body: "Tighten the browser-first workspace without losing the thread.",
    meta: "4 steps",
    details: [
      "Audit the workspace shell and preview route",
      "Keep Repository → Workspace hierarchy persistent",
      "Verify the browser at mobile and desktop widths",
      "Run typecheck, accessibility, and build checks",
    ],
  },
  {
    id: "result",
    kind: "result",
    title: "Preview shell implemented",
    body: "The browser stays visible while the thread grows. Changes and checks now share the review surface below it.",
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
    "bg-[var(--sylph-live)] shadow-[0_0_0_3px_color-mix(in_oklch,var(--sylph-live)_14%,transparent)]",
  waiting: "bg-amber-400",
  ready: "bg-muted-foreground/45",
  error: "bg-destructive",
} satisfies Record<WorkspaceStatus, string>

function UtilityRail() {
  const items = [
    { label: "Home", icon: House },
    { label: "Search", icon: Search },
    { label: "Files", icon: Files },
    { label: "Skills", icon: Sparkles },
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

function RepositoryRail({
  organization,
  repositories,
  workspaceName,
  mobile,
  onClose,
}: {
  organization: string
  repositories: RepositoryGroup[]
  workspaceName: string
  mobile?: boolean
  onClose?: () => void
}) {
  return (
    <aside
      aria-label="Repository and workspace navigation"
      aria-modal={mobile || undefined}
      role={mobile ? "dialog" : undefined}
      className={cn(
        "w-[268px] shrink-0 flex-col border-r bg-sidebar",
        mobile ? "flex" : "hidden md:flex"
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
          Repositories
        </span>
        <Button aria-label="Add repository" size="icon-xs" variant="ghost">
          <Plus />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1 px-2 pb-3">
        <div className="grid gap-2">
          {repositories.map((repository) => (
            <section key={repository.id}>
              <div className="flex h-8 items-center gap-2 px-2 text-xs font-semibold text-foreground/85">
                <ChevronDown className="size-3.5 text-muted-foreground" />
                <FolderGit2 className="size-3.5 text-[#ef9b7e]" />
                <span className="truncate">{repository.name}</span>
                <Button
                  aria-label={`New workspace in ${repository.name}`}
                  className="ml-auto"
                  size="icon-xs"
                  variant="ghost"
                >
                  <Plus />
                </Button>
              </div>
              <div className="ml-[17px] border-l border-white/[.07] pl-1.5">
                {repository.workspaces.map((workspace) => {
                  const active = workspace.name === workspaceName
                  return (
                    <button
                      key={workspace.id}
                      type="button"
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative mb-0.5 grid w-full grid-cols-[12px_minmax(0,1fr)] gap-x-2 rounded-[5px] px-2 py-1.5 text-left transition-colors hover:bg-white/[.045] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                        active && "bg-white/[.065]"
                      )}
                    >
                      {active && (
                        <span className="absolute inset-y-1 left-0 w-px bg-[var(--sylph-coral)]" />
                      )}
                      <span
                        aria-label={`${workspace.status} workspace`}
                        className={cn(
                          "mt-1 size-1.5 rounded-full",
                          statusStyles[workspace.status]
                        )}
                      />
                      <span className="min-w-0">
                        <span
                          className={cn(
                            "block truncate text-xs",
                            active
                              ? "font-medium text-foreground"
                              : "text-muted-foreground group-hover:text-foreground/80"
                          )}
                        >
                          {workspace.name}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <GitBranch className="size-2.5" />
                          <span className="truncate">{workspace.branch}</span>
                          {workspace.changes && (
                            <span className="ml-auto whitespace-nowrap tabular-nums">
                              {workspace.changes}
                            </span>
                          )}
                        </span>
                      </span>
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
  repositoryName,
  workspaceName,
  onOpenNavigation,
}: {
  agentControllingBrowser: boolean
  browser: BrowserState
  checks: CheckItem[]
  demo: boolean
  repositoryName: string
  workspaceName: string
  onOpenNavigation: () => void
}) {
  const passedChecks = checks.filter(
    (check) => check.status === "passed"
  ).length

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
      <Button
        className="md:hidden"
        aria-label="Open navigation"
        size="icon-sm"
        variant="ghost"
        onClick={onOpenNavigation}
      >
        <Files />
      </Button>
      <FolderGit2 className="size-4 text-[#ef9b7e]" />
      <span className="hidden text-xs text-muted-foreground sm:inline">
        {repositoryName}
      </span>
      <ChevronRight className="hidden size-3 text-muted-foreground/50 sm:block" />
      <span className="min-w-0 truncate text-xs font-medium">
        {workspaceName}
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
        <Button size="sm" variant="ghost">
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

function AgentThread({ entries }: { entries: ThreadEntry[] }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <Bot className="size-3.5 text-[#ef9b7e]" />
        <span className="text-xs font-medium">Agent thread</span>
        <span className="text-[10px] text-muted-foreground">Working tree</span>
        <Badge
          className="ml-auto rounded-[4px] px-1.5 font-mono text-[9px]"
          variant="outline"
        >
          5.6 Sol
        </Badge>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-7">
          {entries.map((entry) => (
            <article
              key={entry.id}
              className={cn(
                "border-b border-white/[.06] py-4 first:pt-0 last:border-b-0",
                entry.kind === "tool" && "font-mono text-[12px]"
              )}
            >
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "mt-0.5 grid size-5 shrink-0 place-items-center rounded-[4px] border",
                    entry.kind === "user" && "border-white/10 bg-white/[.04]",
                    entry.kind === "agent" &&
                      "border-[#ef9b7e]/30 bg-[#ef9b7e]/10 text-[#f2a68d]",
                    entry.kind === "tool" &&
                      "border-white/10 bg-black/20 text-muted-foreground",
                    entry.kind === "result" &&
                      "border-emerald-400/20 bg-emerald-400/[.08] text-emerald-300"
                  )}
                >
                  {entry.kind === "user" && <UserRound className="size-3" />}
                  {entry.kind === "agent" && <Sparkles className="size-3" />}
                  {entry.kind === "tool" && <Wrench className="size-3" />}
                  {entry.kind === "result" && <Check className="size-3" />}
                </span>
                <div className="min-w-0 flex-1">
                  {(entry.title || entry.meta) && (
                    <div className="mb-1.5 flex items-center gap-2">
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
                  <p className="text-[13px] leading-5 text-foreground/80">
                    {entry.body}
                  </p>
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
                </div>
              </div>
            </article>
          ))}
        </div>
      </ScrollArea>
      <PromptComposer />
    </section>
  )
}

function PromptComposer() {
  return (
    <div className="shrink-0 p-3 pt-0">
      <div className="mx-auto max-w-3xl border border-white/[.12] bg-[#1c1a18] shadow-[0_16px_45px_rgba(0,0,0,.24)] focus-within:border-[#ef9b7e]/45">
        <Textarea
          aria-label="Message the agent"
          className="min-h-20 resize-none border-0 bg-transparent px-3 py-2.5 text-[13px] shadow-none focus-visible:ring-0"
          placeholder="Ask to make changes, @mention files, or run /commands"
        />
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
            <Sparkles /> Skills
          </Button>
          <Button className="ml-auto" size="xs" variant="ghost">
            Agent <ChevronDown />
          </Button>
          <span className="text-[10px] text-muted-foreground">⌘ ↵</span>
          <Button
            aria-label="Send message"
            className="bg-[#ef9b7e] text-[#241613] hover:bg-[#f4af98]"
            size="icon-sm"
          >
            <ArrowUp />
          </Button>
        </div>
      </div>
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
  checks,
  changeSummary = "No changes",
  changedFileCount = 0,
}: {
  patch?: string
  checks: CheckItem[]
  changeSummary?: string
  changedFileCount?: number
}) {
  return (
    <Tabs className="size-full gap-0" defaultValue="changes">
      <div className="flex h-9 shrink-0 items-center border-y bg-[#171614] px-2">
        <TabsList className="h-8 gap-0 p-0" variant="line">
          <TabsTrigger className="h-8 px-2 text-xs" value="changes">
            Changes{" "}
            <span className="font-mono text-[9px] text-emerald-400">
              {changeSummary}
            </span>
          </TabsTrigger>
          <TabsTrigger className="h-8 px-2 text-xs" value="checks">
            Checks{" "}
            <span className="size-1.5 rounded-full bg-[var(--sylph-live)]" />
          </TabsTrigger>
          <TabsTrigger className="h-8 px-2 text-xs" value="review">
            Review
          </TabsTrigger>
        </TabsList>
        <span className="ml-auto hidden font-mono text-[9px] text-muted-foreground sm:inline">
          {changedFileCount} {changedFileCount === 1 ? "file" : "files"}
        </span>
      </div>
      <TabsContent className="min-h-0 overflow-hidden" value="changes">
        {patch ? (
          <CodeReview className="h-full" patch={patch} />
        ) : (
          <div className="grid min-h-36 place-items-center px-6 text-center">
            <p className="text-xs text-muted-foreground">
              The working tree has no changes.
            </p>
          </div>
        )}
      </TabsContent>
      <TabsContent className="min-h-0 overflow-auto" value="checks">
        <CheckList checks={checks} />
      </TabsContent>
      <TabsContent className="min-h-0 overflow-auto" value="review">
        <div className="grid min-h-36 place-items-center px-6 text-center">
          <p className="text-xs text-muted-foreground">
            Review the selected lines, then hand the change to your editor.
          </p>
        </div>
      </TabsContent>
      <footer className="flex h-9 shrink-0 items-center border-t px-3 text-[10px] text-muted-foreground">
        <span>
          {changedFileCount} {changedFileCount === 1 ? "file" : "files"} changed
        </span>
        <Button className="ml-auto" size="xs" variant="outline">
          Open in editor
        </Button>
      </footer>
    </Tabs>
  )
}

function MobileWorkspaceSurface({
  browser,
  changedFileCount,
  changeSummary,
  checks,
  entries,
  patch,
  previewContent,
}: {
  browser: BrowserState
  changedFileCount?: number
  changeSummary?: string
  checks: CheckItem[]
  entries: ThreadEntry[]
  patch?: string
  previewContent?: ReactNode
}) {
  return (
    <Tabs className="min-h-0 flex-1 gap-0 md:hidden" defaultValue="agent">
      <TabsList
        className="grid h-10 w-full shrink-0 grid-cols-3 rounded-none border-b bg-[#171614] p-0"
        variant="line"
      >
        <TabsTrigger className="h-10 text-xs" value="agent">
          Agent
        </TabsTrigger>
        <TabsTrigger className="h-10 text-xs" value="preview">
          Preview
        </TabsTrigger>
        <TabsTrigger className="h-10 text-xs" value="review">
          Review
        </TabsTrigger>
      </TabsList>
      <TabsContent className="min-h-0" value="agent">
        <AgentThread entries={entries} />
      </TabsContent>
      <TabsContent className="min-h-0" value="preview">
        <BrowserPreview browser={browser} content={previewContent} />
      </TabsContent>
      <TabsContent className="min-h-0" value="review">
        <ReviewSurface
          changedFileCount={changedFileCount}
          changeSummary={changeSummary}
          checks={checks}
          patch={patch}
        />
      </TabsContent>
    </Tabs>
  )
}

function WorkspaceShell({
  organization = "Casey’s workspace",
  repositoryName,
  workspaceName,
  repositories = fallbackRepositories,
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
}: WorkspaceShellProps) {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)

  return (
    <TooltipProvider>
      <div
        className={cn(
          "dark relative m-1.5 flex h-[calc(100svh-0.75rem)] min-h-[620px] overflow-hidden rounded-[10px] border bg-background text-foreground shadow-[0_22px_70px_rgba(0,0,0,.38)]",
          className
        )}
      >
        <UtilityRail />
        <RepositoryRail
          organization={organization}
          repositories={repositories}
          workspaceName={workspaceName}
        />
        <main className="flex min-w-0 flex-1 flex-col">
          <WorkspaceTopbar
            agentControllingBrowser={agentControllingBrowser}
            browser={browser}
            checks={checks}
            demo={demo}
            onOpenNavigation={() => setMobileNavigationOpen(true)}
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
              <RepositoryRail
                mobile
                onClose={() => setMobileNavigationOpen(false)}
                organization={organization}
                repositories={repositories}
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
          <MobileWorkspaceSurface
            browser={browser}
            changedFileCount={changedFileCount}
            changeSummary={changeSummary}
            checks={checks}
            entries={entries}
            patch={patch}
            previewContent={previewContent}
          />
          <div className="hidden min-h-0 flex-1 md:block">
            <ResizablePanelGroup className="min-h-0" orientation="horizontal">
              <ResizablePanel defaultSize="54%" minSize="34%">
                <AgentThread entries={entries} />
              </ResizablePanel>
              <ResizableHandle />
              <ResizablePanel defaultSize="46%" minSize="30%">
                <ResizablePanelGroup orientation="vertical">
                  <ResizablePanel defaultSize="56%" minSize="28%">
                    <BrowserPreview
                      browser={browser}
                      content={previewContent}
                    />
                  </ResizablePanel>
                  <ResizableHandle />
                  <ResizablePanel defaultSize="44%" minSize="22%">
                    <ReviewSurface
                      changedFileCount={changedFileCount}
                      changeSummary={changeSummary}
                      checks={checks}
                      patch={patch}
                    />
                  </ResizablePanel>
                </ResizablePanelGroup>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </main>
      </div>
    </TooltipProvider>
  )
}

export {
  AgentThread,
  BrowserPreview,
  CheckList,
  RepositoryRail,
  ReviewSurface,
  WorkspaceShell,
  WorkspaceTopbar,
  fallbackChecks,
  fallbackEntries,
  fallbackRepositories,
}
export type {
  BrowserState,
  CheckItem,
  RepositoryGroup,
  ThreadEntry,
  WorkspaceItem,
  WorkspaceShellProps,
}
