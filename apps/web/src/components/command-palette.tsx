import { useNavigate, useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { failureMessage, SearchResultList } from "@workspace/domain"
import { CommandPalette as CommandPaletteView } from "@workspace/ui/components/command-palette"
import type {
  CommandItem,
  CommandPaletteDestination,
  CommandPaletteIcon,
  CommandPaletteSelection,
  RecentItem,
} from "@workspace/ui/lib/command-palette"
import { Schema } from "effect"
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import type { AppShellDashboard } from "@/components/app-shell"
import { searchEntities } from "@/functions/search"
import { authClient } from "@/lib/auth-client"
import { commandPaletteDestination } from "@/lib/command-palette-navigation"
import { navigationStorage } from "@/lib/navigation-storage"

const recentStorageKey = "sylph:command-palette-recent:v1"

const StoredDestination = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("home"),
    onboarding: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({ type: Schema.Literal("skills") }),
  Schema.Struct({ type: Schema.Literal("user-settings") }),
  Schema.Struct({ type: Schema.Literal("admin") }),
  Schema.Struct({ type: Schema.Literal("new-project") }),
  Schema.Struct({
    type: Schema.Literal("project-settings"),
    projectSlug: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("project-issues"),
    projectSlug: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("issue"),
    projectSlug: Schema.String,
    issueNumber: Schema.Int,
  }),
  Schema.Struct({
    type: Schema.Literal("workspace"),
    projectSlug: Schema.String,
    workspaceId: Schema.String,
  }),
])
const StoredRecentItem = Schema.Struct({
  kind: Schema.Literal("recent"),
  id: Schema.String,
  label: Schema.String,
  description: Schema.optional(Schema.String),
  icon: Schema.Literals([
    "admin",
    "home",
    "issue",
    "new",
    "project",
    "settings",
    "sign-out",
    "skills",
    "workspace",
  ]),
  destination: StoredDestination,
})
const StoredRecentList = Schema.Array(StoredRecentItem)
const decodeStoredRecentList = Schema.decodeUnknownSync(
  Schema.fromJsonString(StoredRecentList)
)
const encodeStoredRecentList = Schema.encodeSync(
  Schema.fromJsonString(StoredRecentList)
)
const decodeSearchResultList = Schema.decodeUnknownPromise(SearchResultList)

const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement)

const destinationKey = (destination: CommandPaletteDestination) => {
  switch (destination.type) {
    case "home":
      return destination.onboarding ? "home:onboarding" : "home"
    case "project-settings":
    case "project-issues":
      return `${destination.type}:${destination.projectSlug}`
    case "issue":
      return `issue:${destination.projectSlug}:${destination.issueNumber}`
    case "workspace":
      return `workspace:${destination.projectSlug}:${destination.workspaceId}`
    default:
      return destination.type
  }
}

type SelectionPresentation = {
  label: string
  description?: string
  icon: CommandPaletteIcon
}

const selectionDestination = (
  item: CommandPaletteSelection
): CommandPaletteDestination | null => {
  if (item.kind === "recent") return item.destination
  if (item.kind === "command") {
    return item.action.type === "navigate" ? item.action.destination : null
  }
  if (item.kind === "project") {
    return { type: "project-settings", projectSlug: item.slug }
  }
  if (item.kind === "workspace") {
    return {
      type: "workspace",
      projectSlug: item.projectSlug,
      workspaceId: item.id,
    }
  }
  return {
    type: "issue",
    projectSlug: item.projectSlug,
    issueNumber: item.number,
  }
}

const selectionPresentation = (
  item: CommandPaletteSelection
): SelectionPresentation => {
  if (item.kind === "recent") return item
  if (item.kind === "command") {
    return {
      label: item.label,
      description: item.description,
      icon: item.icon,
    }
  }
  if (item.kind === "project") {
    return {
      label: item.name,
      description: item.slug,
      icon: "project" as const,
    }
  }
  if (item.kind === "workspace") {
    return {
      label: item.title,
      description: item.projectName,
      icon: "workspace" as const,
    }
  }
  return {
    label: item.title,
    description: `${item.projectName} · #${item.number}`,
    icon: "issue" as const,
  }
}

const loadRecent = (): RecentItem[] => {
  const stored = navigationStorage.getItem(recentStorageKey)
  if (!stored) return []
  try {
    return [...decodeStoredRecentList(stored)]
  } catch {
    return []
  }
}

const persistRecent = (items: ReadonlyArray<RecentItem>) => {
  navigationStorage.setItem(recentStorageKey, encodeStoredRecentList(items))
}

const commandsForDashboard = (dashboard: AppShellDashboard): CommandItem[] => {
  const commands: CommandItem[] = [
    {
      kind: "command",
      id: "projects",
      label: "Projects",
      keywords: ["home"],
      icon: "home",
      action: { type: "navigate", destination: { type: "home" } },
    },
    {
      kind: "command",
      id: "skills",
      label: "Skills",
      keywords: ["extensions"],
      icon: "skills",
      action: { type: "navigate", destination: { type: "skills" } },
    },
    {
      kind: "command",
      id: "user-settings",
      label: "User settings",
      keywords: ["preferences", "account"],
      icon: "settings",
      action: { type: "navigate", destination: { type: "user-settings" } },
    },
    {
      kind: "command",
      id: "getting-started",
      label: "Getting started",
      keywords: ["onboarding", "help"],
      icon: "home",
      action: {
        type: "navigate",
        destination: { type: "home", onboarding: true },
      },
    },
    {
      kind: "command",
      id: "new-project",
      label: "New Project",
      keywords: ["create"],
      icon: "new",
      action: { type: "navigate", destination: { type: "new-project" } },
    },
  ]
  if (dashboard.installation.canAdminister) {
    commands.push({
      kind: "command",
      id: "administration",
      label: "Administration",
      keywords: ["organization", "providers"],
      icon: "admin",
      action: { type: "navigate", destination: { type: "admin" } },
    })
  }
  for (const project of dashboard.projects) {
    if (dashboard.providerConnected) {
      commands.push({
        kind: "command",
        id: `new-workspace:${project.id}`,
        label: `New Workspace in ${project.name}`,
        keywords: ["create", project.slug],
        icon: "new",
        action: {
          type: "new-workspace",
          projectId: project.id,
          projectSlug: project.slug,
        },
      })
    }
    commands.push(
      {
        kind: "command",
        id: `project-settings:${project.id}`,
        label: `Project settings for ${project.name}`,
        keywords: [project.slug],
        icon: "settings",
        action: {
          type: "navigate",
          destination: { type: "project-settings", projectSlug: project.slug },
        },
      },
      {
        kind: "command",
        id: `issues:${project.id}`,
        label: `Issues in ${project.name}`,
        keywords: [project.slug],
        icon: "issue",
        action: {
          type: "navigate",
          destination: { type: "project-issues", projectSlug: project.slug },
        },
      },
      {
        kind: "command",
        id: `new-issue:${project.id}`,
        label: `New Issue in ${project.name}`,
        keywords: ["create", project.slug],
        icon: "new",
        action: {
          type: "navigate",
          destination: { type: "project-issues", projectSlug: project.slug },
        },
      }
    )
  }
  commands.push({
    kind: "command",
    id: "sign-out",
    label: "Sign out",
    icon: "sign-out",
    action: { type: "sign-out" },
  })
  return commands
}

export function CommandPalette({
  children,
  dashboard,
}: {
  children: (controls: { openSearch: () => void }) => ReactNode
  dashboard: AppShellDashboard
}) {
  const navigate = useNavigate()
  const router = useRouter()
  const search = useServerFn(searchEntities)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResultList>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recent, setRecent] = useState<RecentItem[]>([])
  const sequence = useRef(0)
  const commands = useMemo(() => commandsForDashboard(dashboard), [dashboard])
  const openSearch = useCallback(() => setOpen(true), [])

  useEffect(() => setRecent(loadRecent()), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== "k" ||
        (!event.metaKey && !event.ctrlKey) ||
        isEditableTarget(event.target)
      ) {
        return
      }
      event.preventDefault()
      setOpen((current) => !current)
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  useEffect(() => {
    const normalized = query.trim()
    const requestSequence = ++sequence.current
    setError(null)
    if (!normalized) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    const timer = window.setTimeout(() => {
      void search({ data: { query: normalized } })
        .then(decodeSearchResultList)
        .then((next) => {
          if (requestSequence !== sequence.current) return
          setResults(next)
          setLoading(false)
        })
        .catch((cause) => {
          if (requestSequence !== sequence.current) return
          setResults([])
          setLoading(false)
          setError(failureMessage(cause, "Search is unavailable. Try again."))
        })
    }, 150)
    return () => window.clearTimeout(timer)
  }, [query, search])

  const closeAndReset = () => {
    sequence.current += 1
    setOpen(false)
    setQuery("")
    setResults([])
    setLoading(false)
    setError(null)
  }

  const remember = (
    item: CommandPaletteSelection,
    destination: CommandPaletteDestination
  ) => {
    const presentation = selectionPresentation(item)
    const nextItem: RecentItem = {
      kind: "recent",
      id: destinationKey(destination),
      label: presentation.label,
      description: presentation.description,
      icon: presentation.icon,
      destination,
    }
    setRecent((current) => {
      const next = [
        nextItem,
        ...current.filter((entry) => entry.id !== nextItem.id),
      ].slice(0, 5)
      persistRecent(next)
      return next
    })
  }

  const select = async (item: CommandPaletteSelection) => {
    if (item.kind === "command" && item.action.type === "new-workspace") {
      closeAndReset()
      await navigate({
        to: "/projects/$projectSlug/workspaces/new",
        params: { projectSlug: item.action.projectSlug },
        search: {},
      })
      return
    }
    if (item.kind === "command" && item.action.type === "sign-out") {
      closeAndReset()
      await authClient.signOut()
      await router.invalidate()
      await navigate({ to: "/", search: {} })
      return
    }
    const destination = selectionDestination(item)
    const routerDestination = commandPaletteDestination(item)
    if (!destination || !routerDestination) return
    remember(item, destination)
    closeAndReset()
    await navigate(routerDestination)
  }

  return (
    <>
      {children({ openSearch })}
      <CommandPaletteView
        commands={commands}
        error={error}
        loading={loading}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setQuery("")
        }}
        onQueryChange={setQuery}
        onSelect={(item) => void select(item)}
        open={open}
        query={query}
        recent={recent}
        results={results}
      />
    </>
  )
}
