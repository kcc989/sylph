import type { WorkspaceCheckRun } from "@workspace/domain"
import type {
  CheckItem,
  WorkspaceRuntimeLimits,
} from "@workspace/ui/components/workspace/types"

export type WorkspaceCheckActions = {
  automaticRepairsUsed: number
  limits: WorkspaceRuntimeLimits
  onRepair: (run: Pick<WorkspaceCheckRun, "id">) => void
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

const stageStatus = (
  status: WorkspaceCheckRunView["stages"][number]["status"]
): CheckItem["status"] =>
  status === "passed" || status === "skipped"
    ? "passed"
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
          name: stage.name[0].toUpperCase() + stage.name.slice(1),
          detail:
            stage.durationMs === null
              ? `${stage.detail} · attempt ${attempts}`
              : `${stage.detail} · ${(stage.durationMs / 1000).toFixed(1)}s · attempt ${attempts}`,
          status: stageStatus(stage.status),
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

  if (checkpointCheck?.status === "failed") {
    const repairs = checkpointCheck.repairAttempt ?? 0
    const maxRepairs =
      checkpointCheck.maxRepairAttempts ?? actions.limits.maxRepairAttempts
    const automatic = `${actions.automaticRepairsUsed}/${actions.limits.maxAutomaticRepairs ?? 0} automatic`
    items.push({
      name: "Agent repair",
      detail:
        checkpointCheck.repairStatus === "started"
          ? `Repair Turn ${repairs || 1}/${maxRepairs} · ${Math.round(actions.limits.maxTurnDurationMs / 60_000)} min limit · ${automatic}`
          : `${repairs}/${maxRepairs} repairs used · ${automatic}`,
      status: checkpointCheck.repairStatus === "started" ? "running" : "failed",
      output: checkpointCheck.repairNotice,
      action: {
        label: "Repair",
        disabled:
          actions.pending ||
          checkpointCheck.repairStatus === "started" ||
          repairs >= maxRepairs,
        onClick: () => actions.onRepair(checkpointCheck),
      },
    })
  }

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
        name: `Production ${stage.name}`,
        detail: stage.detail,
        status: stageStatus(stage.status),
        output: productionCheck.diagnostics.find(
          (diagnostic) => diagnostic.stage === stage.name
        )?.output,
      }))
    )
  }

  return items
}
