import { Files, GitCommit } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { CodeReview } from "@workspace/ui/components/code-review"

export function ReviewSurface({
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
