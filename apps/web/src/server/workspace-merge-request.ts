import {
  WorkspaceMergeRequest,
  workspaceAcceptance,
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
  const acceptance = workspaceAcceptance({
    ...input,
    runtimeHealthy: true,
    reviewCommit: versionControl.forkHead,
  })
  return new WorkspaceMergeRequest({
    ready: acceptance.ready,
    blockers: acceptance.blockers,
    baseCommit: versionControl.baseCommit,
    forkHead: versionControl.forkHead,
    projectHead: versionControl.projectHead,
    passingCheckId: acceptance.passingCheckId,
    reviewDecision: input.reviewDecision,
    unresolvedComments: input.unresolvedComments,
    instructions: mergeRequestInstructions,
  })
}

export const reviewDecisionFromRow = (
  value: string | null | undefined
): WorkspaceReviewDecision =>
  value === "approved" || value === "changes_requested" ? value : "pending"
