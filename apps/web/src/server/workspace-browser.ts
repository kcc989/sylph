import {
  WorkspaceBrowserResult,
  WorkspaceCheckEvidence,
  type WorkspaceCheckRun,
} from "@workspace/domain"

const maxMarkdownLength = 24_000
const maxAccessibilityLength = 24_000

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
  const preview =
    (current ? withPreview(current) : null) ??
    checkpoints.map(withPreview).find((candidate) => candidate !== null) ??
    null
  if (!preview) {
    throw new Error(
      "No Preview exists yet. Run workspace_run_checks to build and preview the current Checkpoint first."
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
}) => ({
  screenshot: `${input.runId}-agent-screenshot-${input.sequence}`,
  accessibility: `${input.runId}-agent-accessibility-${input.sequence}`,
})

export const evidenceUrl = (workspaceId: string, evidenceId: string) =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/evidence/${encodeURIComponent(evidenceId)}`

export const browserResult = (input: {
  url: string
  run: WorkspaceCheckRun
  markdown: string
  accessibility: string
  evidence: ReadonlyArray<WorkspaceCheckEvidence>
}) =>
  new WorkspaceBrowserResult({
    url: input.url,
    checkId: input.run.id,
    markdown: bounded(input.markdown, maxMarkdownLength),
    accessibility: bounded(input.accessibility, maxAccessibilityLength),
    evidence: input.evidence,
  })

export const bytesFromBase64 = (value: string) => {
  const decoded = atob(value.replace(/^data:image\/\w+;base64,/, ""))
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
}
