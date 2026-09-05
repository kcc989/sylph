import { useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import {
  resolveSkillInvocation,
  workspaceAcceptance,
  type WorkspacePermissionReply,
} from "@workspace/domain"
import type {
  ThreadEntry,
  WorkspaceQuestionValue,
  WorkspaceReviewCommentDraft,
} from "@workspace/ui/components/workspace/types"
import { isWorkspaceCommandPending } from "@workspace/ui/lib/workspace-commands"
import { useCallback, useEffect, useRef, useState } from "react"

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
  rebaseWorkspace,
  repairWorkspaceCheck,
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
  onDeploy: (commit: string) => Promise<void>
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
  onSubmitPrompt: (
    text: string,
    model: { providerId: string; modelId: string; variant?: string },
    delivery?: "queue" | "steer"
  ) => Promise<boolean | void>
  onSubmitReview: (decision: "approved" | "changes_requested") => Promise<void>
}

export function useWorkspaceActions({
  dismissPermissionRequest,
  refresh,
  result,
  workspaceId,
}: WorkspaceActionsInput) {
  const router = useRouter()
  const prompt = useServerFn(promptWorkspace)
  const cancelTurn = useServerFn(cancelWorkspaceTurn)
  const answerQuestion = useServerFn(answerWorkspaceQuestion)
  const archive = useServerFn(archiveWorkspace)
  const discard = useServerFn(discardWorkspace)
  const checkpoint = useServerFn(checkpointWorkspace)
  const accept = useServerFn(acceptWorkspace)
  const addReviewComment = useServerFn(addWorkspaceReviewComment)
  const restart = useServerFn(restartWorkspace)
  const rebase = useServerFn(rebaseWorkspace)
  const retryCheck = useServerFn(retryWorkspaceCheck)
  const repairCheck = useServerFn(repairWorkspaceCheck)
  const resolveReviewComment = useServerFn(resolveWorkspaceReviewComment)
  const syncProject = useServerFn(syncWorkspaceProject)
  const submitReview = useServerFn(submitWorkspaceReview)
  const deployCommit = useServerFn(deployProjectCommit)
  const commands = useWorkspaceCommands(refresh)
  const [checkpointKey, setCheckpointKey] = useState(() => crypto.randomUUID())
  const [acceptKey, setAcceptKey] = useState(() => crypto.randomUUID())
  const [retryKey, setRetryKey] = useState(() => crypto.randomUUID())
  const [repairKey, setRepairKey] = useState(() => crypto.randomUUID())
  const [deployKey, setDeployKey] = useState(() => crypto.randomUUID())
  const [optimisticEntries, setOptimisticEntries] = useState<ThreadEntry[]>([])
  const [selectedModel, setSelectedModel] = useState(
    result.selectedModel ?? null
  )
  const [modelNotice, setModelNotice] = useState(result.modelNotice ?? null)
  const modelSelectionChanged = useRef(false)
  const modelSelectionWorkspaceId = useRef(workspaceId)

  useEffect(() => setOptimisticEntries([]), [workspaceId])

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

  const matchedSkill = useCallback(
    (text: string) => {
      const invocation = resolveSkillInvocation(text, result.skills)
      if (!invocation) return undefined
      const skill = result.skills.find(
        (candidate) => candidate.metadata.name === invocation.skillId
      )
      return skill
        ? {
            name: invocation.skillId,
            scope: skill.scope,
            prompt: invocation.text,
          }
        : undefined
    },
    [result.skills]
  )

  const runReviewMutation = (mutation: () => Promise<object>) =>
    commands.run(
      "review",
      async () => {
        await mutation()
      },
      "The review could not be updated"
    )

  const workspace = result.workspace
  const acceptance = workspaceAcceptance({
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
  })

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
      runReviewMutation(() =>
        addReviewComment({
          data: {
            workspaceId,
            commit: result.review.commit,
            ...comment,
          },
        })
      ),
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
    onDeploy: async (commit) => {
      const started = await commands.run(
        "deploy",
        async () => {
          await deployCommit({
            data: {
              projectId: workspace.projectId,
              commit,
              confirmedCommit: commit,
              idempotencyKey: deployKey,
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
      result.versionControl.projectChanged &&
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
          await restart({ data: { workspaceId, model: selectedModel } })
        },
        "Workspace restart failed"
      )
    },
    onSubmitPrompt: async (text, model, delivery) => {
      setOptimisticEntries([
        {
          id: `optimistic-${crypto.randomUUID()}`,
          kind: "user",
          body: text,
          skill: matchedSkill(text),
          meta:
            delivery === "steer"
              ? "You · steering"
              : delivery === "queue"
                ? "You · queued"
                : "You",
        },
      ])
      const sent = await commands.run(
        "prompt",
        async () => {
          const response = await prompt({
            data: { workspaceId, text, model, delivery },
          })
          modelSelectionChanged.current = false
          setSelectedModel(response.selectedModel)
          setModelNotice(response.modelNotice)
          await refresh()
        },
        "The assistant could not start the turn",
        { refresh: false, refreshOnFailure: true }
      )
      setOptimisticEntries([])
      return sent
    },
    onSubmitReview: (decision) =>
      runReviewMutation(() =>
        submitReview({
          data: {
            workspaceId,
            commit: result.review.commit,
            decision,
          },
        })
      ).then(() => undefined),
  }

  return {
    acceptance,
    actionProps,
    checkActionPending: isWorkspaceCommandPending(commands.pending, "check"),
    commandError: commands.error,
    matchedSkill,
    modelNotice,
    optimisticEntries,
    pending: commands.pending,
    runRepair: (runId: string) => {
      void commands.run(
        "check",
        async () => {
          await repairCheck({
            data: { workspaceId, runId, idempotencyKey: repairKey },
          })
          setRepairKey(crypto.randomUUID())
        },
        "Repair turn failed"
      )
    },
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
