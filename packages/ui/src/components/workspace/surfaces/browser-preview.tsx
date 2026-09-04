"use client"

import {
  Globe2,
  Maximize2,
  Monitor,
  Play,
  RefreshCw,
  Smartphone,
} from "lucide-react"
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
                  <Globe2 className="size-5" />
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
