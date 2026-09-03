import type { SearchResult } from "@workspace/domain"

export type CommandPaletteIcon =
  | "admin"
  | "home"
  | "issue"
  | "new"
  | "project"
  | "settings"
  | "sign-out"
  | "skills"
  | "workspace"

export type CommandPaletteDestination =
  | { type: "home"; onboarding?: boolean }
  | { type: "skills" }
  | { type: "user-settings" }
  | { type: "admin" }
  | { type: "new-project" }
  | { type: "project-settings"; projectSlug: string }
  | { type: "project-issues"; projectSlug: string }
  | { type: "issue"; projectSlug: string; issueNumber: number }
  | { type: "workspace"; projectSlug: string; workspaceId: string }

export type CommandItem = {
  kind: "command"
  id: string
  label: string
  description?: string
  keywords?: ReadonlyArray<string>
  icon: CommandPaletteIcon
  action:
    | { type: "navigate"; destination: CommandPaletteDestination }
    | { type: "new-workspace"; projectId: string; projectSlug: string }
    | { type: "new-issue"; projectId: string; projectSlug: string }
    | { type: "sign-out" }
}

export type RecentItem = {
  kind: "recent"
  id: string
  label: string
  description?: string
  icon: CommandPaletteIcon
  destination: CommandPaletteDestination
}

export type CommandPaletteSelection = CommandItem | RecentItem | SearchResult

export const filterCommandItems = (
  query: string,
  commands: ReadonlyArray<CommandItem>
) => {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return [...commands]
  return commands.filter((command) =>
    [command.label, command.description ?? "", ...(command.keywords ?? [])]
      .join(" ")
      .toLowerCase()
      .includes(normalized)
  )
}

export const groupSearchResults = (results: ReadonlyArray<SearchResult>) => ({
  projects: results.filter((result) => result.kind === "project"),
  workspaces: results.filter((result) => result.kind === "workspace"),
  issues: results.filter((result) => result.kind === "issue"),
})
