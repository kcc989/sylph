import type { WorkspaceRebaseResult } from "@workspace/domain"

export const serializableWorkspaceRebaseResult = (
  result: WorkspaceRebaseResult
) => ({
  baseCommit: result.baseCommit,
  forkHead: result.forkHead,
  projectHead: result.projectHead,
})
