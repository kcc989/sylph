import type { WorkspaceCheckRun } from "@workspace/domain"

export const browserTargetUrl = (input: {
  previewUrl: string
  path?: string
  url?: string
}) => {
  const preview = new URL(input.previewUrl)
  const target = input.url
    ? new URL(input.url)
    : new URL(input.path ?? "/", preview)
  if (target.origin !== preview.origin) {
    throw new Error(
      `The agent browser is limited to the Preview at ${preview.origin}`
    )
  }
  if (target.protocol !== "https:") {
    throw new Error("The agent browser only opens https Preview URLs")
  }
  return target.toString()
}

const withPreview = (run: WorkspaceCheckRun) =>
  run.previewUrl === null ? null : { run, previewUrl: run.previewUrl }

export const previewForBrowser = (
  runs: ReadonlyArray<WorkspaceCheckRun>,
  forkHead: string
) => {
  const checkpoints = runs.filter((run) => run.kind === "checkpoint")
  const current = checkpoints.find((run) => run.commit === forkHead)
  const preview = current ? withPreview(current) : null
  if (!preview) {
    throw new Error(
      "No Preview exists for the current Checkpoint. Run workspace_run_checks to build and preview it first."
    )
  }
  if (preview.run.status === "running" || preview.run.status === "queued") {
    throw new Error(
      "The current Check is still running. Wait for its result before testing the Preview."
    )
  }
  return preview
}

export const bounded = (value: string, limit: number) =>
  value.length > limit
    ? `${value.slice(0, limit)}\n…[truncated ${value.length - limit} characters]`
    : value

export const browserEvidenceIds = (input: {
  runId: string
  sequence: number
  sessionId?: string
}) => ({
  screenshot: `${input.runId}-agent-screenshot-${input.sessionId ? `${input.sessionId}-` : ""}${input.sequence}`,
  accessibility: `${input.runId}-agent-accessibility-${input.sessionId ? `${input.sessionId}-` : ""}${input.sequence}`,
})

export const evidenceUrl = (workspaceId: string, evidenceId: string) =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/evidence/${encodeURIComponent(evidenceId)}`
