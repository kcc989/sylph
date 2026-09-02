import {
  WorkspaceMergeRequest,
  type WorkspaceCheckRun,
  type WorkspaceReviewDecision,
  type WorkspaceVersionControl,
} from "@workspace/domain"

export const mergeRequestInstructions =
  "A User accepts the Workspace from the Review tab after approving the review. The agent cannot merge."

export const workspaceMergeRequest = (input: {
  versionControl: WorkspaceVersionControl
  checks: ReadonlyArray<WorkspaceCheckRun>
  workspaceStatus: string
  reviewDecision: WorkspaceReviewDecision
  unresolvedComments: number
  turnActive: boolean
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
  if (input.unresolvedComments > 0) {
    blockers.push(
      `${input.unresolvedComments} review comment(s) are unresolved.`
    )
  }
  return new WorkspaceMergeRequest({
    ready: blockers.length === 0,
    blockers,
    baseCommit: versionControl.baseCommit,
    forkHead: versionControl.forkHead,
    projectHead: versionControl.projectHead,
    passingCheckId: passing?.id ?? null,
    reviewDecision: input.reviewDecision,
    unresolvedComments: input.unresolvedComments,
    instructions: mergeRequestInstructions,
  })
}

export const reviewDecisionFromRow = (
  value: string | null | undefined
): WorkspaceReviewDecision =>
  value === "approved" || value === "changes_requested" ? value : "pending"
