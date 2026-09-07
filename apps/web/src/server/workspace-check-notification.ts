import {
  WorkspaceCheckCompletion,
  type WorkspaceCheckRun,
} from "@workspace/domain"

const maxDiagnosticOutput = 4_000

export const isTerminalCheckStatus = (status: WorkspaceCheckRun["status"]) =>
  status === "passed" || status === "failed"

export const checkDiagnosticsText = (run: WorkspaceCheckRun) =>
  run.diagnostics
    .map(
      (diagnostic) =>
        `${diagnostic.stage}: ${diagnostic.summary}\n${diagnostic.output}`
    )
    .join("\n\n")
    .slice(-maxDiagnosticOutput)

const stageSummary = (run: WorkspaceCheckRun) =>
  run.stages
    .map((stage) =>
      stage.durationMs === null
        ? `${stage.name} ${stage.status}`
        : `${stage.name} ${stage.status} (${(stage.durationMs / 1000).toFixed(1)}s)`
    )
    .join(", ")

const evidenceSummary = (run: WorkspaceCheckRun) =>
  run.evidence.length
    ? `Evidence: ${run.evidence.map((item) => `${item.label} ${item.url}`).join("; ")}.`
    : "No browser evidence was captured."

export const checkPassedNotification = (run: WorkspaceCheckRun) =>
  [
    `Sylph Check ${run.id} passed for Checkpoint ${run.commit.slice(0, 7)} (attempt ${run.attempt}).`,
    `Stages: ${stageSummary(run)}.`,
    run.previewUrl
      ? `Preview: ${run.previewUrl}. Use workspace_browser to inspect it.`
      : "No Preview URL was published.",
    evidenceSummary(run),
    "This is a completed Check result. Do not run Workspace checks again unless files change.",
  ].join("\n")

export const checkContinuationPrompt = (run: WorkspaceCheckRun) =>
  `Check ${run.id} failed for Checkpoint ${run.commit} (attempt ${run.attempt}). Fix the failures without weakening validation. Inspect the current Working copy, make the smallest correct changes, then run Workspace checks again. For Bun dependency or lockfile failures, correct package.json if needed and run bun install with the native shell tool to generate bun.lock, then run workspace_run_checks once. Do not hand-edit lockfiles or hashes.\n\n${checkDiagnosticsText(run)}`

export const checkFailedNotification = (
  run: WorkspaceCheckRun,
  reason: string
) =>
  [
    `Sylph Check ${run.id} failed for Checkpoint ${run.commit.slice(0, 7)} (attempt ${run.attempt}).`,
    `Stages: ${stageSummary(run)}.`,
    reason,
    "Explain the failure to the user and wait for direction before changing files.",
    "",
    checkDiagnosticsText(run),
  ].join("\n")

export const checkCompletion = (
  run: WorkspaceCheckRun,
  continuationsUsed: number,
  limit: number
): WorkspaceCheckCompletion | null => {
  if (run.kind === "production" || !isTerminalCheckStatus(run.status))
    return null
  const resume =
    run.kind === "checkpoint" &&
    run.status === "failed" &&
    continuationsUsed < limit
  const text =
    run.status === "passed"
      ? checkPassedNotification(run)
      : resume
        ? checkContinuationPrompt(run)
        : checkFailedNotification(
            run,
            run.kind === "dependencies"
              ? "This legacy dependency job is retired. Use native bun install and a normal Checkpoint Check."
              : `Self-healing CI reached its ${limit}-Turn limit. Send a message to continue.`
          )
  return new WorkspaceCheckCompletion({
    id: `msg_check-completion:${run.id}:${run.attempt}`,
    runId: run.id,
    commit: run.commit,
    attempt: run.attempt,
    text,
    summary:
      run.status === "passed"
        ? `Checks passed · ${run.commit.slice(0, 7)}`
        : resume
          ? `Fixing failed Checks · ${run.commit.slice(0, 7)}`
          : run.kind === "dependencies"
            ? "Dependency Check failed"
            : `Self-healing CI paused · ${limit}-Turn limit`,
    resume,
  })
}
