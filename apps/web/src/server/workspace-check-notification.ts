import type { WorkspaceCheckRun } from "@workspace/domain"

const maxDiagnosticOutput = 12_000

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
    "Summarize the verified change for the user. Do not run Workspace checks again unless files change.",
  ].join("\n")

export const checkRepairPrompt = (run: WorkspaceCheckRun) =>
  `Repair the failures from Check ${run.id} without weakening validation. Inspect the current Working copy, make the smallest correct changes, then run Workspace checks again. For Bun dependency or lockfile failures, correct package.json if needed and call workspace_install_dependencies with {}. It generates bun.lock and starts normal Checks automatically; do not hand-edit lockfiles or hashes, and do not start duplicate Checks.\n\n${checkDiagnosticsText(run)}`

export const checkFailedNotification = (
  run: WorkspaceCheckRun,
  repair: { readonly reason: string }
) =>
  [
    `Sylph Check ${run.id} failed for Checkpoint ${run.commit.slice(0, 7)} (attempt ${run.attempt}).`,
    `Stages: ${stageSummary(run)}.`,
    repair.reason,
    "Explain the failure to the user and wait for direction before changing files.",
    "",
    checkDiagnosticsText(run),
  ].join("\n")

export const repairDisabledReason = "Automatic repair is off for this Check."

export const productionNotification = (run: WorkspaceCheckRun) =>
  run.status === "passed"
    ? `Sylph production Deployment ${run.id} succeeded for Accepted commit ${run.commit.slice(0, 7)}.`
    : `Sylph production Deployment ${run.id} failed for Accepted commit ${run.commit.slice(0, 7)}.\n\n${checkDiagnosticsText(run)}`
