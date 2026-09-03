"use client"

import {
  Check,
  ChevronRight,
  CircleAlert,
  FileText,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react"

import { CodeReview } from "@workspace/ui/components/code-review"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { ResponseMarkdown } from "@workspace/ui/components/response-markdown"
import type { ToolCallEntry } from "@workspace/ui/components/workspace-shell"
import {
  toolCallFamily,
  toolCallLabel,
} from "@workspace/ui/lib/tool-call-summary"

const preClassName =
  "max-h-48 overflow-auto border border-white/[.07] bg-black/20 p-2 font-mono text-[10px] leading-4 whitespace-pre-wrap break-words text-muted-foreground"

function Section({ label, value }: { label: string; value: string }) {
  return (
    <section className="grid min-w-0 gap-1.5">
      <h4 className="text-[10px] font-medium text-foreground/70">{label}</h4>
      <pre className={preClassName}>{value || "No output"}</pre>
    </section>
  )
}

function GenericDetail({ part }: { part: ToolCallEntry }) {
  return (
    <div className="grid gap-3">
      {part.error ? (
        <p className="text-[12px] leading-5 break-words text-[#ef9b7e]">
          {part.error}
        </p>
      ) : null}
      <Section label="Input" value={JSON.stringify(part.input, null, 2)} />
      <Section label="Output" value={part.output} />
      {part.outputTruncated ? (
        <p className="text-[10px] text-muted-foreground">Output truncated</p>
      ) : null}
      {part.files.length ? (
        <section className="grid gap-1.5">
          <h4 className="text-[10px] font-medium text-foreground/70">Files</h4>
          <div className="grid gap-1">
            {part.files.map((file) => (
              <a
                className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                href={file.uri}
                key={`${file.uri}:${file.name ?? ""}`}
                rel="noreferrer"
                target="_blank"
              >
                <FileText className="size-3.5 shrink-0" />
                <span className="truncate">{file.name ?? file.uri}</span>
              </a>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function DiffDetail({ part }: { part: ToolCallEntry }) {
  if (part.detail?.kind !== "diff") return <GenericDetail part={part} />
  return (
    <div className="grid gap-3">
      {part.detail.files.length ? (
        part.detail.files.map((file) => (
          <section
            className="min-w-0 overflow-hidden border border-white/[.07] bg-black/10"
            key={file.file}
          >
            <div className="flex min-w-0 items-center gap-2 px-2.5 py-2 text-[10px]">
              <span className="truncate font-mono text-foreground/80">
                {file.file}
              </span>
              <span className="ml-auto shrink-0 text-muted-foreground capitalize">
                {file.status}
              </span>
              <span className="shrink-0 text-emerald-400">
                +{file.additions}
              </span>
              <span className="shrink-0 text-red-400">−{file.deletions}</span>
            </div>
            <CodeReview className="max-h-80" patch={file.patch} />
          </section>
        ))
      ) : (
        <p className="text-[12px] text-muted-foreground">No changed files.</p>
      )}
    </div>
  )
}

function BrowserDetail({ part }: { part: ToolCallEntry }) {
  if (part.detail?.kind !== "browser") return <GenericDetail part={part} />
  const screenshots = part.detail.evidence.filter(
    (item) => item.kind === "screenshot"
  )
  const accessibilityEvidence = part.detail.evidence.filter(
    (item) => item.kind === "accessibility"
  )
  return (
    <div className="grid min-w-0 gap-3">
      <a
        className="truncate text-[11px] text-[#ef9b7e] underline decoration-[#ef9b7e]/40 underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        href={part.detail.url}
        rel="noreferrer"
        target="_blank"
      >
        {part.detail.url}
      </a>
      {screenshots.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {screenshots.map((item) => (
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
          ))}
        </div>
      ) : null}
      {accessibilityEvidence.map((item) => (
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
      ))}
      {part.detail.markdown ? (
        <div className="max-h-64 overflow-auto border border-white/[.07] bg-black/10 p-2.5">
          <ResponseMarkdown>{part.detail.markdown}</ResponseMarkdown>
        </div>
      ) : null}
      {part.detail.accessibility ? (
        <Collapsible>
          <CollapsibleTrigger
            aria-label="Toggle accessibility tree"
            className="group flex w-full items-center gap-2 py-1 text-[11px] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            type="button"
          >
            <ChevronRight className="size-3.5 transition-transform group-data-panel-open:rotate-90 motion-reduce:transition-none" />
            Accessibility tree
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1.5">
            <pre className={preClassName}>{part.detail.accessibility}</pre>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}

const runStatusIcon = (status: string) => {
  if (status === "passed") return <Check className="size-3 text-emerald-400" />
  if (status === "failed") {
    return <CircleAlert className="size-3 text-destructive" />
  }
  return (
    <LoaderCircle className="size-3 animate-spin text-[#ef9b7e] motion-reduce:animate-none" />
  )
}

function ChecksDetail({ part }: { part: ToolCallEntry }) {
  if (part.detail?.kind !== "checks") return <GenericDetail part={part} />
  return (
    <div className="divide-y divide-white/[.06] border border-white/[.07] bg-black/10">
      {part.detail.runs.map((run) => (
        <div
          className="flex min-w-0 items-center gap-2 px-2.5 py-2"
          key={run.id}
        >
          {runStatusIcon(run.status)}
          <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/80">
            {run.label}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground capitalize">
            {run.status}
          </span>
        </div>
      ))}
    </div>
  )
}

function ToolDetail({ part }: { part: ToolCallEntry }) {
  const family = toolCallFamily(part.name)
  if (
    family === "read-file" ||
    family === "delete-file" ||
    family === "list-files"
  ) {
    return <Section label="Output" value={part.output} />
  }
  if (family === "write-file") {
    return <Section label="Content" value={String(part.input.content ?? "")} />
  }
  if (family === "diff") return <DiffDetail part={part} />
  if (family === "browser") return <BrowserDetail part={part} />
  if (family === "checks") return <ChecksDetail part={part} />
  return <GenericDetail part={part} />
}

function ToolCall({
  part,
  defaultOpen,
}: {
  part: ToolCallEntry
  defaultOpen?: boolean
}) {
  const open = defaultOpen ?? part.status === "error"
  return (
    <Collapsible defaultOpen={open}>
      <CollapsibleTrigger
        aria-label={`${toolCallLabel(part)}, ${part.status}`}
        className="group flex min-h-8 w-full min-w-0 items-center gap-2 py-1 text-start focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        type="button"
      >
        {part.status === "running" ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-[#ef9b7e] motion-reduce:animate-none" />
        ) : part.status === "error" ? (
          <CircleAlert className="size-3.5 shrink-0 text-destructive" />
        ) : (
          <Check className="size-3.5 shrink-0 text-foreground/65" />
        )}
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/80">
          {toolCallLabel(part)}
        </span>
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-90 motion-reduce:transition-none" />
      </CollapsibleTrigger>
      <CollapsibleContent className="min-w-0 ps-[1.375rem] pt-1 pb-2">
        <ToolDetail part={part} />
      </CollapsibleContent>
    </Collapsible>
  )
}

export { ToolCall }
