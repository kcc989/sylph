import type { WorkspaceCheckRun } from "./checks"
import type { WorkspaceReviewDecision } from "./review"
import type { WorkspaceVersionControl } from "./version-control"

export const workspaceAcceptance = (input: {
  versionControl: typeof WorkspaceVersionControl.Encoded
  checks: ReadonlyArray<typeof WorkspaceCheckRun.Encoded>
  workspaceStatus: string
  reviewDecision: WorkspaceReviewDecision
  reviewCommit: string
  unresolvedComments: number
  turnActive: boolean
  runtimeHealthy: boolean
}) => {
  const { versionControl } = input
  const passing =
    input.checks.find(
      (run) =>
        run.kind === "checkpoint" &&
        run.commit === versionControl.forkHead &&
        run.status === "passed"
    ) ?? null
  const blockers: string[] = []
  if (input.workspaceStatus === "archived") {
    blockers.push("The Workspace is archived and read-only.")
  }
  if (input.workspaceStatus === "merging") {
    blockers.push("An Acceptance is already in progress.")
  }
  if (!input.runtimeHealthy) {
    blockers.push("The Workspace runtime is not ready.")
  }
  if (input.turnActive) {
    blockers.push("An agent Turn is still running.")
  }
  if (versionControl.working.length) {
    blockers.push(
      `${versionControl.working.length} Working copy change(s) are not in a Checkpoint.`
    )
  }
  if (!versionControl.branch.length) {
    blockers.push("The Workspace fork has no Checkpoint changes to accept.")
  }
  if (!passing) {
    blockers.push(
      "The latest Checkpoint has not passed its Check, Preview, and browser verification."
    )
  }
  if (versionControl.projectChanged) {
    blockers.push(
      "The Project Repository advanced. Update the Workspace and run a new Check."
    )
  }
  if (input.reviewDecision !== "approved") {
    blockers.push(
      `The review is ${input.reviewDecision.replaceAll("_", " ")}; a User must approve it.`
    )
  }
  if (input.reviewCommit !== versionControl.forkHead) {
    blockers.push("Approve the review for the current Checkpoint.")
  }
  if (input.unresolvedComments > 0) {
    blockers.push(
      `${input.unresolvedComments} review comment(s) are unresolved.`
    )
  }
  return {
    ready: blockers.length === 0,
    blockers,
    passingCheckId: passing?.id ?? null,
  }
}
