import type { SearchResult } from "@workspace/domain"
import {
  Blocks,
  CircleDot,
  FileText,
  FolderKanban,
  House,
  LogOut,
  Plus,
  SearchX,
  Settings2,
  ShieldCheck,
} from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem as CommandRow,
  CommandList,
  CommandSeparator,
} from "@workspace/ui/components/command"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  filterCommandItems,
  groupSearchResults,
  type CommandItem,
  type CommandPaletteIcon,
  type CommandPaletteSelection,
  type RecentItem,
} from "@workspace/ui/lib/command-palette"
import { cn } from "@workspace/ui/lib/utils"
import {
  issueStatusStyles,
  workspaceStatusStyles,
} from "@workspace/ui/lib/status-styles"

const icons = {
  admin: ShieldCheck,
  home: House,
  issue: FileText,
  new: Plus,
  project: FolderKanban,
  settings: Settings2,
  "sign-out": LogOut,
  skills: Blocks,
  workspace: CircleDot,
} satisfies Record<CommandPaletteIcon, typeof House>

type CommandPaletteProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  query: string
  onQueryChange: (query: string) => void
  loading: boolean
  error?: string | null
  commands: ReadonlyArray<CommandItem>
  results: ReadonlyArray<SearchResult>
  recent: ReadonlyArray<RecentItem>
  onSelect: (item: CommandPaletteSelection) => void
}

const resultDescription = (result: SearchResult) => {
  if (result.kind === "project") return result.slug
  if (result.kind === "issue") {
    return `${result.projectName} · #${result.number} · ${result.status}`
  }
  return `${result.projectName} · ${result.status}`
}

function PaletteRow({
  description,
  icon,
  label,
  onSelect,
  value,
  archived,
  iconClassName,
}: {
  description?: string
  icon: CommandPaletteIcon
  label: string
  onSelect: () => void
  value: string
  archived?: boolean
  iconClassName?: string
}) {
  const Icon = icons[icon]
  return (
    <CommandRow value={value} onSelect={onSelect}>
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-[5px] bg-white/[.045] text-muted-foreground",
          iconClassName
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{label}</span>
        {description ? (
          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      {archived ? (
        <Badge variant="outline" className="rounded-[4px] text-[9px]">
          Archived
        </Badge>
      ) : null}
    </CommandRow>
  )
}

export function CommandPalette({
  open,
  onOpenChange,
  query,
  onQueryChange,
  loading,
  error,
  commands,
  results,
  recent,
  onSelect,
}: CommandPaletteProps) {
  const filteredCommands = filterCommandItems(query, commands)
  const grouped = groupSearchResults(results)
  const hasQuery = query.trim().length > 0
  const empty =
    hasQuery &&
    !loading &&
    filteredCommands.length === 0 &&
    results.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-label="Command palette"
        className="overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command label="Command palette" shouldFilter={false} loop>
          <CommandInput
            autoFocus
            placeholder="Search Projects, Workspaces, Issues, and commands…"
            value={query}
            onValueChange={onQueryChange}
          />
          <CommandList>
            {!hasQuery && recent.length > 0 ? (
              <CommandGroup heading="Recent">
                {recent.map((item) => (
                  <PaletteRow
                    key={item.id}
                    description={item.description}
                    icon={item.icon}
                    label={item.label}
                    onSelect={() => onSelect(item)}
                    value={`recent:${item.id}`}
                  />
                ))}
              </CommandGroup>
            ) : null}
            {filteredCommands.length > 0 ? (
              <CommandGroup heading="Commands">
                {filteredCommands.map((item) => (
                  <PaletteRow
                    key={item.id}
                    description={item.description}
                    icon={item.icon}
                    label={item.label}
                    onSelect={() => onSelect(item)}
                    value={`command:${item.id}`}
                  />
                ))}
              </CommandGroup>
            ) : null}
            {hasQuery && filteredCommands.length > 0 && results.length > 0 ? (
              <CommandSeparator alwaysRender />
            ) : null}
            {grouped.projects.length > 0 ? (
              <CommandGroup heading="Projects">
                {grouped.projects.map((item) => (
                  <PaletteRow
                    key={item.id}
                    description={item.slug}
                    icon="project"
                    label={item.name}
                    onSelect={() => onSelect(item)}
                    value={`project:${item.id}`}
                  />
                ))}
              </CommandGroup>
            ) : null}
            {grouped.workspaces.length > 0 ? (
              <CommandGroup heading="Workspaces">
                {grouped.workspaces.map((item) => (
                  <PaletteRow
                    key={item.id}
                    archived={item.status === "archived"}
                    description={resultDescription(item)}
                    icon="workspace"
                    iconClassName={workspaceStatusStyles[item.status]}
                    label={item.title}
                    onSelect={() => onSelect(item)}
                    value={`workspace:${item.id}`}
                  />
                ))}
              </CommandGroup>
            ) : null}
            {grouped.issues.length > 0 ? (
              <CommandGroup heading="Issues">
                {grouped.issues.map((item) => (
                  <PaletteRow
                    key={item.id}
                    description={resultDescription(item)}
                    icon="issue"
                    iconClassName={issueStatusStyles[item.status]}
                    label={item.title}
                    onSelect={() => onSelect(item)}
                    value={`issue:${item.id}`}
                  />
                ))}
              </CommandGroup>
            ) : null}
            {loading ? (
              <div className="flex h-10 items-center gap-2 px-2" role="status">
                <Skeleton className="size-7 rounded-[5px]" />
                <div className="grid flex-1 gap-1.5">
                  <Skeleton className="h-2.5 w-40" />
                  <Skeleton className="h-2 w-24" />
                </div>
                <span className="sr-only">Searching</span>
              </div>
            ) : null}
            {error ? (
              <div
                role="alert"
                className="mx-2 my-1 rounded-[6px] bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {error}
              </div>
            ) : null}
            {empty ? (
              <div className="grid justify-items-center gap-2 px-3 py-8 text-center text-xs text-muted-foreground">
                <SearchX className="size-4" />
                <span>No results for “{query.trim()}”</span>
              </div>
            ) : null}
          </CommandList>
          <footer className="flex h-8 items-center gap-3 border-t px-3 font-mono text-[9px] text-muted-foreground">
            <span>↑↓ move</span>
            <span>↵ open</span>
            <span className={cn("ml-auto", loading && "text-foreground/70")}>
              {loading ? "Searching…" : `${results.length} results`}
            </span>
          </footer>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
