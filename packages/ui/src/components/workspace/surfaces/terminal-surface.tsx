import { Terminal } from "lucide-react"

export function TerminalSurface() {
  return (
    <section className="flex size-full flex-col bg-[var(--sylph-ink)] font-mono text-[11px]">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3 text-muted-foreground">
        <Terminal className="size-3.5" />
        Cloudflare CI terminal
      </header>
      <div className="flex min-h-0 flex-1 items-start gap-2 p-4 text-muted-foreground">
        <span className="text-[var(--sylph-coral)]">$</span>
        <span>The terminal will attach when a Cloudflare CI run starts.</span>
        <span className="mt-0.5 h-3.5 w-1.5 animate-pulse bg-foreground/70 motion-reduce:animate-none" />
      </div>
    </section>
  )
}
