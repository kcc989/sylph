import type { WorkspaceCheckRun } from "@workspace/domain"
import type {
  CheckItem,
  WorkspaceRuntimeLimits,
} from "@workspace/ui/components/workspace/types"

export type WorkspaceCheckActions = {
  limits: WorkspaceRuntimeLimits
  onRetry: (run: Pick<WorkspaceCheckRun, "id">) => void
  onUpdateProject: () => void
  pending: boolean
  projectChanged: boolean
  workingChanges: number
}

type WorkspaceCheckRunView = Omit<
  WorkspaceCheckRun,
  "commit" | "workspaceId"
> & {
  commit: string
  workspaceId: string
}

export const workspaceCheckStageStatus = (
  status: WorkspaceCheckRunView["stages"][number]["status"]
): CheckItem["status"] =>
  status === "passed" || status === "skipped"
    ? status
    : status === "failed"
      ? "failed"
      : status === "running"
        ? "running"
        : "queued"

export const workspaceCheckItems = (
  checkpointCheck: WorkspaceCheckRunView | undefined,
  productionCheck: WorkspaceCheckRunView | undefined,
  actions: WorkspaceCheckActions
): CheckItem[] => {
  const items: CheckItem[] = checkpointCheck
    ? checkpointCheck.stages.map((stage, index) => {
        const diagnostic = checkpointCheck.diagnostics.find(
          (item) => item.stage === stage.name
        )
        const failed = stage.status === "failed"
        const firstFailure = checkpointCheck.stages.findIndex(
          (candidate) => candidate.status === "failed"
        )
        const attempts = `${checkpointCheck.attempt}/${checkpointCheck.maxAttempts ?? actions.limits.maxCheckAttempts}`
        return {
          commit: checkpointCheck.commit,
          target: "checkpoint",
          name:
            stage.name === "browser"
              ? "Homepage identity"
              : stage.name[0].toUpperCase() + stage.name.slice(1),
          detail:
            stage.durationMs === null
              ? `${stage.detail} · attempt ${attempts}`
              : `${stage.detail} · ${(stage.durationMs / 1000).toFixed(1)}s · attempt ${attempts}`,
          status: workspaceCheckStageStatus(stage.status),
          output: diagnostic?.output,
          evidence:
            stage.name === "browser" ? checkpointCheck.evidence : undefined,
          action:
            failed && index === firstFailure
              ? {
                  label: "Retry",
                  disabled: actions.pending,
                  onClick: () => actions.onRetry(checkpointCheck),
                }
              : undefined,
        }
      })
    : []

  if (actions.projectChanged) {
    items.unshift({
      name: "Project Repository",
      detail: "A newer commit is available",
      status: "failed",
      action: {
        label: "Update",
        disabled: actions.pending || actions.workingChanges > 0,
        onClick: actions.onUpdateProject,
      },
    })
  }

  if (productionCheck) {
    items.push(
      ...productionCheck.stages.map((stage) => ({
        commit: productionCheck.commit,
        target: "production" as const,
        name: `Production ${stage.name}`,
        detail: stage.detail,
        status: workspaceCheckStageStatus(stage.status),
        output: productionCheck.diagnostics.find(
          (diagnostic) => diagnostic.stage === stage.name
        )?.output,
      }))
    )
  }

  return items
}
