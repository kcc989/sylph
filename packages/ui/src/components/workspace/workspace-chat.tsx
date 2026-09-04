"use client"

import { PanelRightClose, PanelRightOpen } from "lucide-react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { AgentThread } from "./workspace-thread/agent-thread"
import {
  useWorkspaceShell,
  useWorkspaceShellStore,
} from "./workspace-shell-provider"
import { setWorkspaceToolPaneOpen } from "./workspace-shell-store"
import type {
  ComposerModel,
  ComposerSkill,
  ThreadEntry,
  WorkspacePermissionRequest,
  WorkspaceQuestion,
  WorkspaceQuestionValue,
  WorkspaceQueuedMessage,
  WorkspaceRuntimeLimits,
} from "./types"

function WorkspaceToolToggle({
  open,
  onToggle,
}: {
  open: boolean
  onToggle: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        aria-controls="workspace-tools"
        aria-expanded={open}
        aria-label={open ? "Hide tool sidebar" : "Open tool sidebar"}
        className={cn(
          "ml-auto grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          open && "bg-accent text-accent-foreground"
        )}
        onClick={onToggle}
      >
        {open ? (
          <PanelRightClose className="size-4" />
        ) : (
          <PanelRightOpen className="size-4" />
        )}
      </TooltipTrigger>
      <TooltipContent>{open ? "Hide tools" : "Open tools"}</TooltipContent>
    </Tooltip>
  )
}

export function WorkspaceChat({
  entries,
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
  onRestartWorkspace,
  promptDisabled,
  promptError,
  promptPending,
  cancelTurnPending,
  restartPending,
  workspaceError,
  models,
  skills,
  selectedModel,
  modelNotice,
  onModelChange,
}: {
  entries: ThreadEntry[]
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
    model: { providerId: string; modelId: string },
    delivery?: "queue" | "steer"
  ) => Promise<void>
  onRestartWorkspace?: () => Promise<void>
  promptDisabled?: boolean
  promptError?: string | null
  promptPending?: boolean
  cancelTurnPending?: boolean
  restartPending?: boolean
  workspaceError?: string | null
  models: ReadonlyArray<ComposerModel>
  skills: ReadonlyArray<ComposerSkill>
  selectedModel?: { providerId: string; modelId: string } | null
  modelNotice?: string | null
  onModelChange?: (model: { providerId: string; modelId: string }) => void
}) {
  const store = useWorkspaceShellStore()
  const toolPaneOpen = useWorkspaceShell((state) => state.toolPaneOpen)

  return (
    <section
      aria-label="Workspace conversation"
      className="flex size-full min-w-0 flex-col bg-background"
    >
      <header className="flex h-10 shrink-0 items-center border-b px-3">
        <WorkspaceToolToggle
          open={toolPaneOpen}
          onToggle={() => setWorkspaceToolPaneOpen(store, !toolPaneOpen)}
        />
      </header>
      <AgentThread
        entries={entries}
        permissionRequests={permissionRequests}
        questions={questions}
        queuedMessages={queuedMessages}
        runtimeLimits={runtimeLimits}
        turnActive={turnActive}
        turnInterrupted={turnInterrupted}
        activeTurnStartedAt={activeTurnStartedAt}
        answeringQuestionId={answeringQuestionId}
        replyingPermissionId={replyingPermissionId}
        onPermissionReply={onPermissionReply}
        onAnswerQuestion={onAnswerQuestion}
        onCancelTurn={onCancelTurn}
        initialPrompt={initialPrompt}
        onSubmitPrompt={onSubmitPrompt}
        promptDisabled={promptDisabled}
        promptError={promptError}
        promptPending={promptPending}
        cancelTurnPending={cancelTurnPending}
        restartPending={restartPending}
        onRestartWorkspace={onRestartWorkspace}
        workspaceError={workspaceError}
        models={models}
        skills={skills}
        selectedModel={selectedModel}
        modelNotice={modelNotice}
        onModelChange={onModelChange}
      />
    </section>
  )
}
