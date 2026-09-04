"use client"

import { Maximize2, Monitor, Play, RefreshCw, Smartphone } from "lucide-react"
import { useState, type ReactNode } from "react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import type { BrowserState } from "../types"

export function BrowserPreview({
  browser,
  content,
  onExpand,
  onRefresh,
  onRunTest,
  onReference,
}: {
  browser: BrowserState
  content?: ReactNode
  onExpand?: () => void
  onRefresh?: () => void
  onRunTest?: () => void
  onReference?: () => void
}) {
  const [refresh, setRefresh] = useState(0)
  const [viewportMode, setViewportMode] = useState<"responsive" | "mobile">(
    "responsive"
  )

  return (
    <section className="flex size-full min-h-0 flex-col bg-[#161513]">
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b px-2">
        <Button
          aria-label="Refresh preview"
          size="icon-xs"
          variant="ghost"
          onClick={() => {
            setRefresh((value) => value + 1)
            onRefresh?.()
          }}
        >
          <RefreshCw />
        </Button>
        <input
          aria-label="Preview URL"
          readOnly
          value={browser.url}
          className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1.5 text-xs text-muted-foreground"
        />
        {onRunTest ? (
          <Button
            aria-label="Run browser test"
            size="icon-xs"
            variant="ghost"
            onClick={onRunTest}
          >
            <Play />
          </Button>
        ) : null}
        {onExpand ? (
          <Button
            aria-label="Expand preview"
            size="icon-xs"
            variant="ghost"
            onClick={onExpand}
          >
            <Maximize2 />
          </Button>
        ) : null}
        <span className="hidden font-mono text-[9px] text-muted-foreground lg:inline">
          {viewportMode === "mobile" ? "Up to 390px" : "Responsive"}
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
                key={`${browser.url}:${refresh}`}
                className="size-full border-0 bg-white"
                referrerPolicy="no-referrer"
                sandbox="allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
                src={browser.url}
                title={browser.title}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center px-8 text-center">
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
      </div>
      {onReference && browser.status === "live" ? (
        <footer className="flex shrink-0 items-center justify-between gap-2 border-t px-3 py-2">
          <span className="truncate text-xs text-muted-foreground">
            {browser.commit
              ? `Checkpoint ${browser.commit.slice(0, 7)}`
              : browser.title}
          </span>
          <Button size="xs" variant="outline" onClick={onReference}>
            Reference preview
          </Button>
        </footer>
      ) : null}
    </section>
  )
}
