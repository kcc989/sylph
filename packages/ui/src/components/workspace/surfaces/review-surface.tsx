"use client"

import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  CodeReview,
  type CodeReviewSelection,
} from "@workspace/ui/components/code-review"

export function ReviewSurface({
  patch,
  changeSummary = "No changes",
  changedFileCount = 0,
  checkpointHistory = [],
  onReference,
}: {
  onReference?: (selection: CodeReviewSelection) => void
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
  const [selected, setSelected] = useState<{
    patch: string | undefined
    selection: CodeReviewSelection | null
  } | null>(null)
  const selection =
    selected && selected.patch === patch ? selected.selection : null
  return (
    <section className="flex size-full min-h-0 flex-col bg-[var(--sylph-ink)]">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b bg-[#171614] px-3">
        <span className="text-xs font-medium">Working copy</span>
        <span className="font-mono text-[9px] text-emerald-400">
          {changeSummary}
        </span>
        <span className="ml-auto font-mono text-[9px] text-muted-foreground">
          {changedFileCount} {changedFileCount === 1 ? "file" : "files"}
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">
        {patch ? (
          <CodeReview
            key={patch}
            className="h-full"
            patch={patch}
            onLineSelected={(selection) => setSelected({ patch, selection })}
            selectedLines={selection}
          />
        ) : (
          <div className="grid h-full place-items-center px-6 text-center">
            <p className="text-xs text-muted-foreground">
              The working tree has no changes.
            </p>
          </div>
        )}
      </div>
      {checkpointHistory.length ? (
        <details className="max-h-28 shrink-0 overflow-auto border-t bg-[#171614]">
          <summary className="cursor-pointer px-3 py-2 text-xs">
            Checkpoint history
          </summary>
          {checkpointHistory.map((checkpoint) => (
            <div
              className="flex items-center gap-2 border-b border-white/[.05] px-3 py-1.5 text-[10px] last:border-b-0"
              key={checkpoint.id}
            >
              <span className="min-w-0 flex-1 truncate text-foreground/80">
                {checkpoint.message}
              </span>
              <span className="font-mono text-muted-foreground">
                {checkpoint.commit.slice(0, 7)}
              </span>
            </div>
          ))}
        </details>
      ) : null}
      <footer className="flex h-9 shrink-0 items-center border-t px-3 text-[10px] text-muted-foreground">
        <span>
          {changedFileCount} {changedFileCount === 1 ? "file" : "files"} changed
        </span>
        {onReference ? (
          <Button
            className="ml-auto"
            size="xs"
            variant="outline"
            disabled={!selection}
            onClick={() => {
              if (selection) onReference(selection)
            }}
          >
            Reference selected lines
          </Button>
        ) : null}
      </footer>
    </section>
  )
}
