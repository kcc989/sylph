"use client"

import { File as CodeFile } from "@pierre/diffs/react"
import {
  ChevronRight,
  File,
  Folder,
  LoaderCircle,
  PanelLeft,
} from "lucide-react"
import { useEffect, useState } from "react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import type {
  WorkspaceFileChangeView,
  WorkspaceFileContentView,
} from "../types"

type FileTreeEntry = {
  name: string
  path: string
  files: ReadonlyArray<string>
  directories: ReadonlyArray<FileTreeEntry>
}

type MutableFileTreeEntry = {
  name: string
  path: string
  files: string[]
  directories: Map<string, MutableFileTreeEntry>
}

const buildFileTree = (paths: ReadonlyArray<string>): FileTreeEntry => {
  const root: MutableFileTreeEntry = {
    name: "",
    path: "",
    files: [],
    directories: new Map(),
  }
  for (const path of paths) {
    const segments = path.split("/").filter(Boolean)
    let directory = root
    for (const segment of segments.slice(0, -1)) {
      const childPath = directory.path
        ? `${directory.path}/${segment}`
        : segment
      let child = directory.directories.get(segment)
      if (!child) {
        child = {
          name: segment,
          path: childPath,
          files: [],
          directories: new Map(),
        }
        directory.directories.set(segment, child)
      }
      directory = child
    }
    const file = segments.at(-1)
    if (file) directory.files.push(path)
  }
  const finalize = (entry: MutableFileTreeEntry): FileTreeEntry => ({
    name: entry.name,
    path: entry.path,
    files: [...entry.files].sort(),
    directories: [...entry.directories.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(finalize),
  })
  return finalize(root)
}

const fileStatusLabel = {
  added: "A",
  modified: "M",
  deleted: "D",
} as const

function FileTreeDirectory({
  entry,
  selectedPath,
  changes,
  onSelect,
  depth = 0,
}: {
  entry: FileTreeEntry
  selectedPath: string | null
  changes: ReadonlyMap<string, WorkspaceFileChangeView["status"]>
  onSelect: (path: string) => void
  depth?: number
}) {
  return (
    <>
      {entry.directories.map((directory) => (
        <Collapsible defaultOpen key={directory.path}>
          <CollapsibleTrigger className="group flex h-7 w-full items-center gap-1.5 px-2 text-left text-xs text-muted-foreground hover:bg-white/[.035] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset">
            <ChevronRight className="size-3 shrink-0 transition-transform group-data-panel-open:rotate-90" />
            <Folder className="size-3.5 shrink-0" />
            <span className="truncate">{directory.name}</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="ml-3 border-l border-white/[.07]">
              <FileTreeDirectory
                changes={changes}
                depth={depth + 1}
                entry={directory}
                onSelect={onSelect}
                selectedPath={selectedPath}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      ))}
      {entry.files.map((path) => {
        const name = path.split("/").at(-1) ?? path
        const status = changes.get(path)
        return (
          <button
            aria-current={selectedPath === path ? "page" : undefined}
            className={cn(
              "flex h-7 w-full items-center gap-1.5 px-2 text-left text-xs text-muted-foreground hover:bg-white/[.035] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
              selectedPath === path && "bg-white/[.065] text-foreground"
            )}
            key={path}
            onClick={() => onSelect(path)}
            style={{ paddingLeft: `${8 + depth * 4}px` }}
            type="button"
          >
            <File className="ml-3 size-3.5 shrink-0" />
            <span className="truncate">{name}</span>
            {status ? (
              <span
                aria-label={status}
                className={cn(
                  "ml-auto font-mono text-[10px]",
                  status === "deleted"
                    ? "text-destructive"
                    : "text-[var(--sylph-coral)]"
                )}
              >
                {fileStatusLabel[status]}
              </span>
            ) : null}
          </button>
        )
      })}
    </>
  )
}

export function FilesSurface({
  files,
  fileChanges,
  onReadFile,
  onReferenceFile,
}: {
  files: ReadonlyArray<string>
  fileChanges: ReadonlyArray<WorkspaceFileChangeView>
  onReferenceFile?: (path: string) => void
  onReadFile?: (path: string) => Promise<WorkspaceFileContentView>
}) {
  const paths = Array.from(
    new Set([...files, ...fileChanges.map((change) => change.file)])
  ).sort()
  const [query, setQuery] = useState("")
  const [treeOpen, setTreeOpen] = useState(true)
  const matchingPaths = paths.filter((path) =>
    path.toLowerCase().includes(query.toLowerCase())
  )
  const tree = buildFileTree(matchingPaths)
  const changes = new Map(
    fileChanges.map((change) => [change.file, change.status] as const)
  )
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [content, setContent] = useState<WorkspaceFileContentView | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!selectedPath || !onReadFile) return
    let current = true
    setLoading(true)
    setLoadError(null)
    setContent(null)
    void onReadFile(selectedPath)
      .then((next) => {
        if (current) setContent(next)
      })
      .catch(() => {
        if (current) setLoadError("This Workspace File could not be loaded.")
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [fileChanges, files, onReadFile, selectedPath])

  return (
    <section className="@container flex size-full min-h-0 flex-col bg-[var(--sylph-ink)]">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b bg-[#171614] px-2 text-xs text-muted-foreground">
        <Button
          aria-label={treeOpen ? "Hide file tree" : "Show file tree"}
          aria-pressed={treeOpen}
          size="icon-sm"
          variant="ghost"
          onClick={() => setTreeOpen(!treeOpen)}
        >
          <PanelLeft />
        </Button>
        Workspace Files
        <span className="ml-auto font-mono text-[10px] tabular-nums">
          {files.length} files
        </span>
      </header>
      <div
        className={cn(
          "grid min-h-0 flex-1 grid-cols-1",
          treeOpen && "grid-cols-[clamp(8rem,30%,16rem)_minmax(0,1fr)]"
        )}
      >
        <aside
          aria-label="File tree"
          className={cn(
            "flex min-h-0 min-w-0 flex-col border-r",
            !treeOpen && "hidden"
          )}
        >
          <div className="shrink-0 p-2">
            <Input
              aria-label="Search files"
              placeholder="Search files"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <ScrollArea className="min-h-0 flex-1">
            {matchingPaths.length ? (
              <div className="py-1">
                <FileTreeDirectory
                  changes={changes}
                  entry={tree}
                  onSelect={setSelectedPath}
                  selectedPath={selectedPath}
                />
              </div>
            ) : (
              <p className="p-3 text-xs leading-5 text-muted-foreground">
                {paths.length
                  ? "No files match your search."
                  : "This Workspace has no files."}
              </p>
            )}
          </ScrollArea>
        </aside>
        <div
          aria-label="File contents"
          className="flex min-h-0 min-w-0 flex-col"
        >
          <div className="flex h-8 shrink-0 items-center border-b px-3 font-mono text-[10px] text-muted-foreground">
            <span className="truncate">
              {selectedPath ?? "Select a Workspace File"}
            </span>
            {selectedPath && onReferenceFile ? (
              <Button
                className="ml-auto shrink-0"
                size="xs"
                variant="ghost"
                onClick={() => onReferenceFile(selectedPath)}
              >
                Reference file
              </Button>
            ) : null}
            {loading ? (
              <LoaderCircle className="ml-auto size-3 animate-spin motion-reduce:animate-none" />
            ) : null}
          </div>
          <ScrollArea className="min-h-0 flex-1">
            {!selectedPath ? (
              <p className="p-4 text-xs text-muted-foreground">
                Select a Workspace File to view its contents.
              </p>
            ) : loadError ? (
              <p className="p-4 text-xs text-destructive" role="alert">
                {loadError} Try again after the Workspace reconnects.
              </p>
            ) : content?.encoding === "binary" ? (
              <p className="p-4 text-xs text-muted-foreground">
                This binary Workspace File cannot be displayed.
              </p>
            ) : content?.encoding === "too-large" ? (
              <p className="p-4 text-xs text-muted-foreground">
                This Workspace File is too large to display.
              </p>
            ) : content?.encoding === "missing" ? (
              <p className="p-4 text-xs text-muted-foreground">
                This Workspace File no longer exists.
              </p>
            ) : content?.encoding === "utf8" ? (
              <CodeFile
                file={{ name: selectedPath, contents: content.content ?? "" }}
                disableWorkerPool
                options={{
                  themeType: "dark",
                  theme: "github-dark-default",
                  disableFileHeader: true,
                  overflow: "wrap",
                }}
              />
            ) : null}
          </ScrollArea>
        </div>
      </div>
    </section>
  )
}
