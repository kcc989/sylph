"use client"

import { AgentThread } from "./workspace-thread/agent-thread"
import {
  useWorkspaceShell,
  useWorkspaceShellStore,
} from "./workspace-shell-provider"
import {
  openWorkspaceTool,
  inspectWorkspaceActivity,
} from "./workspace-shell-store"
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
  ) => Promise<boolean | void>
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
  const references = useWorkspaceShell((state) => state.references)

  return (
    <section
      aria-label="Workspace conversation"
      className="flex size-full min-w-0 flex-col bg-background"
    >
      <AgentThread
        onOpenEvidence={(kind) => openWorkspaceTool(store, kind)}
        references={references}
        onRemoveReference={(text) =>
          store.setState((state) => ({
            ...state,
            references: state.references.filter((item) => item.text !== text),
          }))
        }
        onOpenFiles={() => openWorkspaceTool(store, "files")}
        onInspectActivity={(id) => inspectWorkspaceActivity(store, id)}
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
        onSubmitPrompt={
          onSubmitPrompt
            ? async (text, model, delivery) => {
                const sent = await onSubmitPrompt(text, model, delivery)
                if (sent === false) return false
                store.setState((state) => ({
                  ...state,
                  references: state.references.filter(
                    (item) => !references.includes(item)
                  ),
                }))
              }
            : undefined
        }
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
