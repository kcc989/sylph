import type { WorkspaceCheckRun } from "@workspace/domain"

export const previewForRequest = (
  runs: ReadonlyArray<WorkspaceCheckRun>,
  commit: string,
  captureEvidence: boolean
) => {
  const current = runs.find(
    (run) => run.kind === "preview" && run.commit === commit
  )
  const compatible = Boolean(
    current && (!captureEvidence || current.captureEvidence)
  )
  return {
    current,
    compatible,
    reusable: Boolean(
      compatible &&
      current &&
      (current.previewUrl ||
        current.status === "running" ||
        current.status === "queued")
    ),
  }
}
