import { useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import {
  workspaceAcceptance,
  workspacePromptMessageId,
  type WorkspacePermissionReply,
} from "@workspace/domain"
import type {
  WorkspaceQuestionValue,
  WorkspaceReviewCommentDraft,
} from "@workspace/ui/components/workspace/types"
import { useEffect, useRef, useState } from "react"

import {
  addWorkspaceReviewComment,
  resolveWorkspaceReviewComment,
  submitWorkspaceReview,
} from "@/functions/review"
import { deployProjectCommit } from "@/functions/projects"
import {
  acceptWorkspace,
  answerWorkspaceQuestion,
  archiveWorkspace,
  cancelWorkspaceTurn,
  checkpointWorkspace,
  discardWorkspace,
  getWorkspace,
  promptWorkspace,
  retryWorkspaceQueuedMessage,
  rebaseWorkspace,
  restartWorkspace,
  retryWorkspaceCheck,
  syncWorkspaceProject,
} from "@/functions/workspaces"
import { useWorkspaceCommands } from "@/lib/use-workspace-commands"

type WorkspaceResult = Awaited<ReturnType<typeof getWorkspace>>

type WorkspaceActionsInput = {
  workspaceId: string
  result: WorkspaceResult
  refresh: () => Promise<void>
  dismissPermissionRequest: (requestId: string) => void
  trackPrompt: (
    id: string,
    text: string,
    delivery?: "queue" | "steer"
  ) => (accepted: boolean) => void
}

type WorkspaceActionProps = {
  onAccept?: () => Promise<void>
  onAddReviewComment: (comment: WorkspaceReviewCommentDraft) => Promise<boolean>
  onAnswerQuestion: (
    questionId: string,
    answer: Record<string, WorkspaceQuestionValue>
  ) => Promise<void>
  onArchiveWorkspace?: () => Promise<void>
  onCancelTurn: () => Promise<void>
  onCheckpoint?: () => Promise<void>
  onDiscardWorkspace: () => Promise<void>
  onDeploy: (
    commit: string,
    recoveryDeploymentId?: string,
    options?: { managedRelease?: boolean; captureEvidence?: boolean }
  ) => Promise<void>
  onModelChange: (model: {
    providerId: string
    modelId: string
    variant?: string
  }) => void
  onPermissionReply: (
    requestId: string,
    reply: "once" | "always" | "reject"
  ) => Promise<void>
  onRebase?: () => Promise<void>
  onResolveReviewComment: (
    commentId: string,
    resolved: boolean
  ) => Promise<void>
  onRestartWorkspace: () => Promise<void>
  onRetryQueuedMessage: (messageId: string) => Promise<void>
  onSubmitPrompt: (
    text: string,
    model: { providerId: string; modelId: string; variant?: string },
    delivery?: "queue" | "steer"
  ) => Promise<boolean | void>
  onSubmitReview: (decision: "approved" | "changes_requested") => Promise<void>
}

export function useWorkspaceActions({
  dismissPermissionRequest,
  trackPrompt,
  refresh,
  result,
  workspaceId,
}: WorkspaceActionsInput) {
  const router = useRouter()
  const retryQueuedMessage = useServerFn(retryWorkspaceQueuedMessage)
  const promptSubmission = useRef<{ id: string; signature: string } | null>(
    null
  )
  const prompt = useServerFn(promptWorkspace)
  const cancelTurn = useServerFn(cancelWorkspaceTurn)
  const answerQuestion = useServerFn(answerWorkspaceQuestion)
  const archive = useServerFn(archiveWorkspace)
  const discard = useServerFn(discardWorkspace)
  const checkpoint = useServerFn(checkpointWorkspace)
  const accept = useServerFn(acceptWorkspace)
  const addReviewComment = useServerFn(addWorkspaceReviewComment)
  const restart = useServerFn(restartWorkspace)
  const restartRequest = useRef(crypto.randomUUID())
  const rebase = useServerFn(rebaseWorkspace)
  const retryCheck = useServerFn(retryWorkspaceCheck)
  const resolveReviewComment = useServerFn(resolveWorkspaceReviewComment)
  const syncProject = useServerFn(syncWorkspaceProject)
  const submitReview = useServerFn(submitWorkspaceReview)
  const deployCommit = useServerFn(deployProjectCommit)
  const commands = useWorkspaceCommands(refresh)
  const [checkpointKey, setCheckpointKey] = useState(() => crypto.randomUUID())
  const [acceptKey, setAcceptKey] = useState(() => crypto.randomUUID())
  const [retryKey, setRetryKey] = useState(() => crypto.randomUUID())
  const [deployKey, setDeployKey] = useState(() => crypto.randomUUID())
  const [selectedModel, setSelectedModel] = useState(
    result.selectedModel ?? null
  )
  const [modelNotice, setModelNotice] = useState(result.modelNotice ?? null)
  const modelSelectionChanged = useRef(false)
  const modelSelectionWorkspaceId = useRef(workspaceId)

  useEffect(() => {
    const workspaceChanged = modelSelectionWorkspaceId.current !== workspaceId
    if (workspaceChanged) {
      modelSelectionWorkspaceId.current = workspaceId
      modelSelectionChanged.current = false
    }
    if (workspaceChanged || !modelSelectionChanged.current) {
      setSelectedModel(result.selectedModel ?? null)
      setModelNotice(result.modelNotice ?? null)
    }
  }, [
    result.modelNotice,
    result.selectedModel?.modelId,
    result.selectedModel?.providerId,
    result.selectedModel?.variant,
    workspaceId,
  ])

  const runReviewMutation = (mutation: () => Promise<object>) =>
    commands.run(
      "review",
      async () => {
        await mutation()
      },
      "The review could not be updated"
    )

  const workspace = result.workspace
  const acceptance =
    result.versionControl && result.review
      ? workspaceAcceptance({
          versionControl: result.versionControl,
          checks: result.checks,
          workspaceStatus: workspace.status,
          reviewDecision: result.review.decision,
          reviewCommit: result.review.commit,
          unresolvedComments: result.review.comments.filter(
            (comment) => comment.resolvedAt === null
          ).length,
          turnActive: result.runtime.status === "running",
          runtimeHealthy: result.runtime.opencode.healthy,
          browserProof: result.runtime.browserProof,
          conversationId: result.runtime.sessionId,
        })
      : {
          ready: false,
          blockers: ["The Workspace is still being set up."],
          passingCheckId: null,
        }

  const actionProps: WorkspaceActionProps = {
    onAccept: acceptance.ready
      ? async () => {
          await commands.run(
            "accept",
            async () => {
              await accept({
                data: { workspaceId, idempotencyKey: acceptKey },
              })
              setAcceptKey(crypto.randomUUID())
            },
            "Accept failed"
          )
        }
      : undefined,
    onAddReviewComment: (comment) =>
      runReviewMutation(async () => {
        if (!result.review) throw new Error("Workspace review is not ready")
        return addReviewComment({
          data: {
            workspaceId,
            commit: result.review.commit,
            ...comment,
          },
        })
      }),
    onAnswerQuestion: async (
      questionId,
      answer: Record<string, WorkspaceQuestionValue>
    ) => {
      await commands.run(
        "answerQuestion",
        async () => {
          await answerQuestion({ data: { workspaceId, questionId, answer } })
        },
        "The agent question answer could not be sent",
        { target: questionId }
      )
    },
    onArchiveWorkspace:
      workspace.status !== "archived"
        ? async () => {
            await commands.run(
              "archive",
              async () => {
                await archive({ data: { workspaceId } })
              },
              "Workspace archive failed"
            )
          }
        : undefined,
    onCancelTurn: async () => {
      await commands.run(
        "cancelTurn",
        async () => {
          await cancelTurn({ data: { workspaceId } })
        },
        "Turn cancellation failed"
      )
    },
    onCheckpoint:
      workspace.status !== "archived"
        ? async () => {
            await commands.run(
              "checkpoint",
              async () => {
                await checkpoint({
                  data: {
                    workspaceId,
                    idempotencyKey: checkpointKey,
                    message: "Checkpoint Workspace changes",
                  },
                })
                setCheckpointKey(crypto.randomUUID())
              },
              "Checkpoint failed"
            )
          }
        : undefined,
    onDiscardWorkspace: async () => {
      await commands.run(
        "discard",
        async () => {
          await discard({ data: { workspaceId } })
          await router.navigate({ to: "/" })
        },
        "Workspace discard failed",
        { refresh: false }
      )
    },
    onDeploy: async (commit, recoveryDeploymentId, options) => {
      const started = await commands.run(
        "deploy",
        async () => {
          await deployCommit({
            data: {
              projectId: workspace.projectId,
              commit,
              confirmedCommit: commit,
              idempotencyKey: deployKey,
              recoveryDeploymentId,
              managedRelease: options?.managedRelease,
              captureEvidence: options?.captureEvidence,
              confirmedDataLoss: recoveryDeploymentId ? true : undefined,
            },
          })
          setDeployKey(crypto.randomUUID())
        },
        "Deployment could not start",
        { target: commit }
      )
      if (!started) throw new Error("Deployment could not start")
    },
    onModelChange: (model) => {
      modelSelectionChanged.current = true
      setSelectedModel({ ...model, variant: model.variant })
      setModelNotice(null)
    },
    onPermissionReply: async (requestId, reply) => {
      await commands.run(
        "permissionReply",
        async () => {
          const response = await fetch(
            `/api/workspaces/${encodeURIComponent(workspaceId)}`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                workspaceId,
                requestId,
                reply: reply satisfies WorkspacePermissionReply,
              }),
            }
          )
          if (!response.ok) throw new Error(await response.text())
          dismissPermissionRequest(requestId)
        },
        "The permission response could not be sent",
        { target: requestId, refresh: false }
      )
    },
    onRebase:
      result.versionControl?.projectChanged &&
      workspace.status !== "merging" &&
      workspace.status !== "archived"
        ? async () => {
            await commands.run(
              "rebase",
              async () => {
                await rebase({ data: { workspaceId } })
              },
              "Rebase failed"
            )
          }
        : undefined,
    onResolveReviewComment: (commentId, resolved) =>
      runReviewMutation(() =>
        resolveReviewComment({ data: { workspaceId, commentId, resolved } })
      ).then(() => undefined),
    onRestartWorkspace: async () => {
      await commands.run(
        "restart",
        async () => {
          await restart({
            data: {
              workspaceId,
              model: selectedModel,
              idempotencyKey: restartRequest.current,
            },
          })
          restartRequest.current = crypto.randomUUID()
        },
        "Workspace restart failed"
      )
    },
    onRetryQueuedMessage: async (messageId) => {
      await commands.run(
        "prompt",
        () => retryQueuedMessage({ data: { workspaceId, messageId } }),
        "Could not retry the queued message"
      )
    },
    onSubmitPrompt: async (text, model, delivery) => {
      const signature = JSON.stringify({ text, model, delivery })
      if (promptSubmission.current?.signature !== signature)
        promptSubmission.current = { id: workspacePromptMessageId(), signature }
      const messageId = promptSubmission.current.id
      const finishPrompt = trackPrompt(messageId, text, delivery)
      const sent = await commands.run(
        "prompt",
        async () => {
          const response = await prompt({
            data: {
              workspaceId,
              text,
              model,
              delivery,
              messageId,
            },
          })
          modelSelectionChanged.current = false
          setSelectedModel(response.selectedModel)
          setModelNotice(response.modelNotice)
          await refresh()
        },
        "The assistant could not start the turn",
        { refresh: false, refreshOnFailure: true }
      )
      finishPrompt(sent)
      if (sent) promptSubmission.current = null
      return sent
    },
    onSubmitReview: (decision) =>
      runReviewMutation(async () => {
        if (!result.review) throw new Error("Workspace review is not ready")
        return submitReview({
          data: {
            workspaceId,
            commit: result.review.commit,
            decision,
          },
        })
      }).then(() => undefined),
  }

  return {
    acceptance,
    actionProps,
    checkActionPending: commands.isPending("check"),
    errorExcept: commands.errorExcept,
    errorFor: commands.errorFor,
    isPending: commands.isPending,
    modelNotice,
    pendingTarget: commands.pendingTarget,
    runRetry: (runId: string) => {
      void commands.run(
        "check",
        async () => {
          await retryCheck({
            data: { workspaceId, runId, idempotencyKey: retryKey },
          })
          setRetryKey(crypto.randomUUID())
        },
        "Check retry failed"
      )
    },
    runUpdateProject: () => {
      void commands.run(
        "check",
        async () => {
          await syncProject({ data: { workspaceId } })
        },
        "Repository update failed"
      )
    },
    selectedModel,
  }
}
