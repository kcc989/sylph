"use client"

import type { ReactNode } from "react"

import {
  Activity,
  Check,
  ChevronRight,
  CircleAlert,
  Files,
  LoaderCircle,
  MessagesSquare,
  RefreshCw,
  Square,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller"
import { cn } from "@workspace/ui/lib/utils"
import { ToolCall } from "@workspace/ui/components/tool-call"
import { groupToolCalls } from "@workspace/ui/lib/tool-call-summary"
import { PromptComposer } from "../prompt-composer"
import type {
  ComposerModel,
  ComposerSkill,
  ThreadEntry,
  WorkspacePermissionRequest,
  WorkspaceQuestion,
  WorkspaceQuestionValue,
  WorkspaceQueuedMessage,
  WorkspaceRuntimeLimits,
} from "../types"

import { SkillInvocationMessage } from "./skill-invocation-message"
import { AgentQuestion } from "./agent-question"
import { PermissionRequest } from "./permission-request"
import { ResponseMarkdown } from "./response-markdown"

function ThreadEntryRow({ entry }: { entry: ThreadEntry }) {
  return (
    <MessageScrollerItem
      className={cn(
        "py-2 first:pt-0 last:pb-4",
        entry.kind === "user" && "flex justify-end"
      )}
      messageId={entry.id}
    >
      <article
        className={cn(
          "min-w-0",
          entry.kind === "user"
            ? "max-w-[85%] rounded-[18px] rounded-br-[6px] bg-white/[.07] px-4 py-2.5"
            : "w-full"
        )}
      >
        {entry.kind === "tool" && entry.tool ? (
          <ToolCall part={entry.tool} />
        ) : (
          <>
            {(entry.title || entry.meta) && (
              <div
                className={cn(
                  "mb-1.5 flex items-center gap-2",
                  entry.kind === "user" && "hidden",
                  entry.kind === "agent" && !entry.title && "hidden"
                )}
              >
                {entry.title && (
                  <h3 className="text-xs font-medium text-foreground/90">
                    {entry.title}
                  </h3>
                )}
                {entry.meta && (
                  <span className="text-[10px] text-muted-foreground">
                    {entry.meta}
                  </span>
                )}
              </div>
            )}
            {entry.kind === "agent" || entry.kind === "result" ? (
              <ResponseMarkdown>{entry.body}</ResponseMarkdown>
            ) : entry.kind === "user" ? (
              <SkillInvocationMessage entry={entry} />
            ) : (
              <p className="text-[13px] leading-5 whitespace-pre-wrap text-foreground/80">
                {entry.body}
              </p>
            )}
            {entry.details && (
              <ul className="mt-3 grid gap-1.5">
                {entry.details.map((detail) => (
                  <li
                    className="flex items-center gap-2 text-[12px] text-muted-foreground"
                    key={detail}
                  >
                    <Check className="size-3 text-foreground/70" />
                    {detail}
                  </li>
                ))}
              </ul>
            )}
            {entry.artifact && (
              <div className="mt-3 flex items-center gap-2 border border-white/[.09] bg-white/[.025] px-2.5 py-2">
                <Activity className="size-3.5 text-[#ef9b7e]" />
                <span className="text-[11px] font-medium">
                  {entry.artifact.label}
                </span>
                <span className="ml-auto truncate font-mono text-[9px] text-muted-foreground">
                  {entry.artifact.detail}
                </span>
              </div>
            )}
          </>
        )}
      </article>
    </MessageScrollerItem>
  )
}

function ToolCallGroup({ entries }: { entries: ReadonlyArray<ThreadEntry> }) {
  return (
    <MessageScrollerItem
      className="py-2 first:pt-0 last:pb-4"
      messageId={`tool-group:${entries[0]?.id ?? "empty"}`}
    >
      <Collapsible>
        <CollapsibleTrigger
          aria-label={`Toggle ${entries.length} tool calls`}
          className="group flex min-h-8 w-full items-center gap-2 py-1 text-start focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          type="button"
        >
          <Files className="size-3.5 shrink-0 text-foreground/65" />
          <span className="min-w-0 flex-1 text-[13px] text-foreground/80">
            {entries.length} tool calls
          </span>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-90 motion-reduce:transition-none" />
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-0.5 ps-[1.375rem] pt-1 pb-2">
          {entries.map((entry) =>
            entry.tool ? <ToolCall key={entry.id} part={entry.tool} /> : null
          )}
        </CollapsibleContent>
      </Collapsible>
    </MessageScrollerItem>
  )
}

export function AgentThread({
  entries,
  historyControls,
  permissionRequests,
  questions,
  queuedMessages,
  runtimeLimits,
  turnActive,
  turnInterrupted,
  activeTurnStartedAt,
  answeringQuestionId,
  replyingPermissionId,
  onPermissionReply,
  onAnswerQuestion,
  onCancelTurn,
  initialPrompt,
  onSubmitPrompt,
  promptDisabled,
  promptError,
  promptPending,
  cancelTurnPending,
  restartPending,
  onRestartWorkspace,
  workspaceError,
  models,
  skills,
  selectedModel,
  modelNotice,
  onModelChange,
}: {
  entries: ThreadEntry[]
  historyControls?: ReactNode
  permissionRequests: ReadonlyArray<WorkspacePermissionRequest>
  questions: ReadonlyArray<WorkspaceQuestion>
  queuedMessages: ReadonlyArray<WorkspaceQueuedMessage>
  runtimeLimits?: WorkspaceRuntimeLimits
  turnActive: boolean
  turnInterrupted: boolean
  activeTurnStartedAt?: number | null
  answeringQuestionId?: string | null
  replyingPermissionId?: string | null
  onPermissionReply?: (
    requestId: string,
    reply: "once" | "always" | "reject"
  ) => Promise<void>
  onAnswerQuestion?: (
    questionId: string,
    answer: Record<string, WorkspaceQuestionValue>
  ) => Promise<void>
  onCancelTurn?: () => Promise<void>
  initialPrompt?: string
  onSubmitPrompt?: (
    text: string,
    model: { providerId: string; modelId: string }
  ) => Promise<void>
  promptDisabled?: boolean
  promptError?: string | null
  promptPending?: boolean
  cancelTurnPending?: boolean
  restartPending?: boolean
  onRestartWorkspace?: () => Promise<void>
  workspaceError?: string | null
  models: ReadonlyArray<ComposerModel>
  skills: ReadonlyArray<ComposerSkill>
  selectedModel?: { providerId: string; modelId: string } | null
  modelNotice?: string | null
  onModelChange?: (model: { providerId: string; modelId: string }) => void
}) {
  const renderEntries = groupToolCalls(entries)
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-background">
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport>
            <MessageScrollerContent className="mx-auto w-full max-w-3xl justify-end px-4 py-5 sm:px-7">
              {historyControls}
              {renderEntries.map((entry) =>
                "entries" in entry ? (
                  <ToolCallGroup entries={entry.entries} key={entry.id} />
                ) : (
                  <ThreadEntryRow entry={entry} key={entry.id} />
                )
              )}
              {permissionRequests.map((request) => (
                <MessageScrollerItem
                  className="py-2 last:pb-4"
                  key={request.id}
                  messageId={request.id}
                >
                  <PermissionRequest
                    onReply={onPermissionReply}
                    pending={replyingPermissionId === request.id}
                    request={request}
                  />
                </MessageScrollerItem>
              ))}
              {questions.map((question) => (
                <MessageScrollerItem
                  className="py-2 last:pb-4"
                  key={question.id}
                  messageId={question.id}
                >
                  <AgentQuestion
                    onAnswer={onAnswerQuestion}
                    pending={answeringQuestionId === question.id}
                    question={question}
                  />
                </MessageScrollerItem>
              ))}
              {queuedMessages.map((message, index) => (
                <MessageScrollerItem
                  className="py-1 last:pb-4"
                  key={message.id}
                  messageId={message.id}
                >
                  <article className="flex min-w-0 items-start gap-2 border border-white/[.08] bg-white/[.025] px-3 py-2">
                    <MessagesSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] leading-4 break-words text-foreground/75">
                        {message.text}
                      </p>
                      <p className="mt-1 text-[9px] text-muted-foreground">
                        {message.delivery === "steer"
                          ? "Steering active Turn"
                          : `Queued ${index + 1} of ${runtimeLimits?.maxQueuedMessages ?? queuedMessages.length}`}
                      </p>
                    </div>
                  </article>
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      {workspaceError ? (
        <div className="mx-auto mb-3 flex w-[calc(100%-1.5rem)] max-w-3xl flex-col items-stretch gap-3 border border-destructive/25 bg-destructive/[.06] px-3 py-2.5 sm:flex-row sm:items-center">
          <CircleAlert className="size-4 shrink-0 text-destructive" />
          <p className="min-w-0 flex-1 text-[11px] text-foreground/80">
            {workspaceError}
          </p>
          {onRestartWorkspace ? (
            <Button
              className="self-end sm:self-auto"
              size="sm"
              type="button"
              variant="outline"
              disabled={restartPending}
              onClick={onRestartWorkspace}
            >
              {restartPending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              Restart
            </Button>
          ) : null}
        </div>
      ) : null}
      {turnInterrupted && !workspaceError ? (
        <div
          className="mx-auto mb-3 flex w-[calc(100%-1.5rem)] max-w-3xl items-start gap-2 border border-amber-400/25 bg-amber-400/[.055] px-3 py-2.5"
          role="status"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
          <p className="min-w-0 text-[11px] leading-4 text-foreground/80">
            The last Turn was interrupted. Files and Conversation history are
            safe. Send a new message to continue from the current Working copy.
          </p>
        </div>
      ) : null}
      {turnActive ? (
        <div
          className="mx-auto mb-2 flex w-[calc(100%-1.5rem)] max-w-3xl flex-wrap items-center gap-2 border border-white/[.09] bg-white/[.025] px-3 py-2"
          role="status"
        >
          <LoaderCircle className="size-3.5 animate-spin text-[#ef9b7e] motion-reduce:animate-none" />
          <span className="text-[11px] text-foreground/80">Agent working</span>
          <span className="font-mono text-[9px] text-muted-foreground">
            {runtimeLimits
              ? `${Math.round(runtimeLimits.maxTurnDurationMs / 60_000)} min limit · ${queuedMessages.length}/${runtimeLimits.maxQueuedMessages} queued`
              : "Turn active"}
          </span>
          {activeTurnStartedAt ? (
            <span className="hidden font-mono text-[9px] text-muted-foreground sm:inline">
              started {new Date(activeTurnStartedAt).toLocaleTimeString()}
            </span>
          ) : null}
          <Button
            className="ml-auto"
            disabled={cancelTurnPending}
            onClick={onCancelTurn}
            size="xs"
            type="button"
            variant="outline"
          >
            {cancelTurnPending ? (
              <LoaderCircle className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Square />
            )}
            Cancel Turn
          </Button>
        </div>
      ) : null}
      <PromptComposer
        disabled={promptDisabled}
        error={promptError}
        initialPrompt={initialPrompt}
        onSubmit={onSubmitPrompt}
        pending={promptPending}
        models={models}
        skills={skills}
        selectedModel={selectedModel}
        modelNotice={modelNotice}
        onModelChange={onModelChange}
        turnActive={turnActive}
        queueFull={
          runtimeLimits
            ? queuedMessages.length >= runtimeLimits.maxQueuedMessages
            : false
        }
      />
    </section>
  )
}
