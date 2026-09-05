"use client"

import {
  ArrowUp,
  X,
  Blocks,
  LoaderCircle,
  MessagesSquare,
  Terminal,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { ThinkingModelPicker } from "./thinking-model-picker"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"
import type { WorkspaceReference } from "./workspace-shell-store"
import type { ComposerModel, ComposerSkill } from "./types"

export function PromptComposer({
  disabled = false,
  error,
  initialPrompt = "",
  onSubmit,
  pending = false,
  models,
  skills,
  selectedModel,
  modelNotice,
  onModelChange,
  turnActive = false,
  queueFull = false,
  references = [],
  onRemoveReference,
  onOpenFiles,
}: {
  disabled?: boolean
  error?: string | null
  initialPrompt?: string
  onSubmit?: (
    text: string,
    model: { providerId: string; modelId: string; variant?: string },
    delivery?: "queue" | "steer"
  ) => Promise<boolean | void>
  pending?: boolean
  models: ReadonlyArray<ComposerModel>
  skills: ReadonlyArray<ComposerSkill>
  selectedModel?: {
    providerId: string
    modelId: string
    variant?: string
  } | null
  modelNotice?: string | null
  onModelChange?: (model: {
    providerId: string
    modelId: string
    variant?: string
  }) => void
  turnActive?: boolean
  queueFull?: boolean
  references?: WorkspaceReference[]
  onRemoveReference?: (text: string) => void
  onOpenFiles?: () => void
}) {
  const [text, setText] = useState(initialPrompt)
  const [activeSkillIndex, setActiveSkillIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const commandQuery = /^\/([^\s]*)$/.exec(text)?.[1]?.toLocaleLowerCase()
  const matchingSkills =
    commandQuery === undefined
      ? []
      : skills.filter((skill) =>
          skill.name.toLocaleLowerCase().includes(commandQuery)
        )

  useEffect(() => setActiveSkillIndex(0), [commandQuery])

  const selectSkill = (skill: ComposerSkill) => {
    setText(`/${skill.name} `)
    textareaRef.current?.focus()
  }
  const submit = async (delivery?: "queue" | "steer") => {
    const prompt = text.trim()

    if (!prompt || disabled || pending || !onSubmit || !selectedModel) return
    if (delivery === "queue" && queueFull) return
    const sent = await onSubmit(
      [prompt, ...references.map((item) => item.text)].join("\n\n"),
      selectedModel,
      delivery
    )
    if (sent !== false) setText("")
  }

  return (
    <div className="shrink-0 p-3 pt-0">
      <form
        className="@container relative mx-auto max-w-3xl rounded-xl border border-white/[.12] bg-[#1c1a18] focus-within:border-[#ef9b7e]/45"
        onSubmit={async (event) => {
          event.preventDefault()
          await submit(turnActive ? "queue" : undefined)
        }}
      >
        {references.length ? (
          <div
            aria-label="Attached context"
            className="flex flex-wrap gap-1.5 px-3 pt-3"
          >
            {references.map((item) => (
              <span
                key={item.text}
                className="flex max-w-full items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs"
              >
                <span className="truncate" title={item.text}>
                  {item.label}
                </span>
                <Button
                  type="button"
                  aria-label={`Remove ${item.label} reference`}
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => onRemoveReference?.(item.text)}
                >
                  <X />
                </Button>
              </span>
            ))}
          </div>
        ) : null}
        {matchingSkills.length ? (
          <div
            aria-label="Skill commands"
            className="absolute inset-x-[-1px] bottom-[calc(100%+5px)] z-20 max-h-64 overflow-y-auto border border-white/[.12] bg-[#1c1a18] p-1 shadow-[0_16px_45px_rgba(0,0,0,.35)]"
            role="listbox"
          >
            {matchingSkills.map((skill, index) => (
              <button
                aria-selected={index === activeSkillIndex}
                className={cn(
                  "grid w-full grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-2 px-2 py-2 text-left outline-none hover:bg-white/[.07] focus-visible:bg-white/[.07]",
                  index === activeSkillIndex && "bg-white/[.07]"
                )}
                key={`${skill.scope}/${skill.name}`}
                onClick={() => selectSkill(skill)}
                role="option"
                type="button"
              >
                <Blocks className="mt-0.5 size-3.5 text-[#ef9b7e]" />
                <span className="min-w-0">
                  <span className="block font-mono text-[11px] text-foreground">
                    /{skill.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                    {skill.description}
                  </span>
                </span>
                <span className="pt-0.5 text-[9px] text-muted-foreground uppercase">
                  {skill.scope}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <Textarea
          aria-label="Message the agent"
          className="min-h-20 resize-none border-0 bg-transparent px-3 py-2.5 text-[13px] shadow-none focus-visible:ring-0"
          disabled={disabled || pending}
          ref={textareaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={async (event) => {
            if (matchingSkills.length && event.key === "ArrowDown") {
              event.preventDefault()
              setActiveSkillIndex((index) =>
                Math.min(index + 1, matchingSkills.length - 1)
              )
              return
            }
            if (matchingSkills.length && event.key === "ArrowUp") {
              event.preventDefault()
              setActiveSkillIndex((index) => Math.max(index - 1, 0))
              return
            }
            if (matchingSkills.length && event.key === "Enter") {
              event.preventDefault()
              const skill = matchingSkills[activeSkillIndex]
              if (skill) selectSkill(skill)
              return
            }
            if (matchingSkills.length && event.key === "Escape") {
              event.preventDefault()
              setText("")
              return
            }
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              await submit(turnActive ? "queue" : undefined)
            }
          }}
          placeholder={
            disabled
              ? "This Workspace is not accepting messages"
              : turnActive
                ? "Queue the next message or steer the active Turn"
                : "Ask OpenCode to create or change the Project"
          }
        />
        {error ? (
          <p role="alert" className="px-3 pb-2 text-[11px] text-destructive">
            {error}
          </p>
        ) : null}
        {modelNotice ? (
          <p className="border-t border-white/[.07] px-3 py-2 text-[11px] leading-4 break-words text-muted-foreground">
            {modelNotice}
          </p>
        ) : null}
        <div className="flex min-h-12 min-w-0 items-center gap-1 px-2 py-2">
          <ThinkingModelPicker
            disabled={disabled || pending || turnActive || models.length === 0}
            models={models}
            selectedModel={selectedModel ?? null}
            onModelChange={onModelChange}
          />
          {onOpenFiles ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              aria-label="Attach files"
              className="shrink-0"
              onClick={onOpenFiles}
            >
              <span className="hidden @md:inline">Files</span>
              <Blocks className="@md:hidden" />
            </Button>
          ) : null}
          <Button
            aria-label="Open command"
            className="hidden @lg:inline-flex"
            size="icon-xs"
            variant="ghost"
            type="button"
            onClick={() => {
              setText("/")
              textareaRef.current?.focus()
            }}
          >
            <Terminal />
          </Button>
          <Button
            className="hidden @xl:inline-flex"
            size="xs"
            type="button"
            variant="ghost"
            onClick={() => {
              setText("/")
              textareaRef.current?.focus()
            }}
          >
            <Blocks /> Skills
          </Button>
          <span className="hidden text-[10px] whitespace-nowrap text-muted-foreground @2xl:inline">
            ⌘ ↵
          </span>
          {turnActive ? (
            <>
              <Button
                disabled={disabled || pending || !text.trim() || !selectedModel}
                onClick={() => void submit("steer")}
                size="xs"
                type="button"
                variant="outline"
              >
                <ArrowUp /> Steer
              </Button>
              <Button
                className="shrink-0 bg-[#ef9b7e] text-[#241613] hover:bg-[#f4af98]"
                disabled={
                  disabled ||
                  pending ||
                  queueFull ||
                  !text.trim() ||
                  !selectedModel
                }
                size="xs"
                type="submit"
              >
                {pending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <MessagesSquare />
                )}
                Queue
              </Button>
            </>
          ) : (
            <Button
              aria-label="Send message"
              className="shrink-0 bg-[#ef9b7e] text-[#241613] hover:bg-[#f4af98]"
              disabled={disabled || pending || !text.trim() || !selectedModel}
              size="icon-sm"
              type="submit"
            >
              {pending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <ArrowUp />
              )}
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}
