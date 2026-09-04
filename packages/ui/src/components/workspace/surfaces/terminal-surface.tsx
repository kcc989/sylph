"use client"

import { X } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { useWorkspaceShellStore } from "../workspace-shell-provider"
import type { ThreadEntry, CheckItem } from "../types"

export function TerminalSurface({
  entries = [],
  checks = [],
}: {
  entries?: ThreadEntry[]
  checks?: CheckItem[]
}) {
  const store = useWorkspaceShellStore()
  const commands = entries.flatMap((entry) =>
    entry.tool && /bash|shell|exec|command|terminal/i.test(entry.tool.name)
      ? [entry.tool]
      : []
  )
  const outputs = checks.filter((check) => check.output)
  return (
    <section
      aria-label="Command output"
      className="flex size-full min-h-0 flex-col bg-[var(--sylph-ink)]"
    >
      <header className="flex h-9 shrink-0 items-center justify-between border-b px-3">
        <span className="text-xs font-medium">Command output</span>
        <Button
          aria-label="Close command output"
          size="icon-xs"
          variant="ghost"
          onClick={() =>
            store.setState((state) => ({ ...state, terminalOpen: false }))
          }
        >
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {commands.length || outputs.length ? (
          <div className="space-y-4">
            {commands.map((command) => (
              <article key={command.id}>
                <h3 className="mb-1 text-xs text-muted-foreground">
                  {command.name} · {command.status}
                </h3>
                <pre className="font-mono text-xs leading-5 break-words whitespace-pre-wrap">
                  {command.error || command.output || "Waiting for output…"}
                </pre>
                {command.outputTruncated ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Output truncated by the runtime.
                  </p>
                ) : null}
              </article>
            ))}
            {outputs.map((check) => (
              <article key={check.name}>
                <h3 className="mb-1 text-xs text-muted-foreground">
                  {check.name} · {check.status}
                </h3>
                <pre className="font-mono text-xs leading-5 break-words whitespace-pre-wrap">
                  {check.output}
                </pre>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-xs leading-5 text-muted-foreground">
            No command output yet. Agent commands and check logs appear here
            when available.
          </p>
        )}
      </div>
    </section>
  )
}
