import { Check, LoaderCircle, Minus, ShieldCheck, X } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import type { CheckItem } from "../types"

export function CheckList({ checks }: { checks: CheckItem[] }) {
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
        <div key={check.name} className="px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            {check.status === "passed" && (
              <Check className="size-3.5 text-emerald-400" />
            )}
            {check.status === "running" && (
              <LoaderCircle className="size-3.5 animate-spin text-[#ef9b7e] motion-reduce:animate-none" />
            )}
            {check.status === "queued" && (
              <span className="size-3.5 rounded-full border border-muted-foreground/50" />
            )}
            {check.status === "failed" && (
              <X className="size-3.5 text-destructive" />
            )}
            {check.status === "skipped" && (
              <Minus className="size-3.5 text-muted-foreground" />
            )}
            <span className="text-xs font-medium">{check.name}</span>
            <span className="sr-only">{check.status}</span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              {check.detail}
            </span>
            {check.action ? (
              <Button
                disabled={check.action.disabled}
                onClick={check.action.onClick}
                size="xs"
                variant="outline"
              >
                {check.action.label}
              </Button>
            ) : null}
          </div>
          {check.output ? (
            <pre className="mt-2 max-h-48 overflow-auto border border-white/[.07] bg-black/20 p-2 font-mono text-[10px] leading-4 whitespace-pre-wrap text-muted-foreground">
              {check.output}
            </pre>
          ) : null}
          {check.evidence?.length ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {check.evidence.map((item) =>
                item.kind === "screenshot" ? (
                  <a
                    className="overflow-hidden border border-white/[.08] bg-black/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    href={item.url}
                    key={item.id}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <img
                      alt={item.label}
                      className="aspect-video w-full object-cover object-top"
                      src={item.url}
                    />
                    <span className="block px-2 py-1.5 text-[10px] text-muted-foreground">
                      {item.label}
                    </span>
                  </a>
                ) : (
                  <a
                    className="flex items-center gap-2 border border-white/[.08] bg-black/20 px-2 py-2 text-[10px] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    href={item.url}
                    key={item.id}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ShieldCheck className="size-3.5 text-[var(--sylph-live)]" />
                    {item.label}
                  </a>
                )
              )}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
