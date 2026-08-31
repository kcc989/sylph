import type { WorkspaceCheckpointResult } from "@workspace/domain"

export const serializableWorkspaceCheckpointResult = (
  result: WorkspaceCheckpointResult
) => ({
  checkpoint: {
    id: result.checkpoint.id,
    commit: result.checkpoint.commit,
    message: result.checkpoint.message,
    createdAt: result.checkpoint.createdAt,
  },
  replayed: result.replayed,
})
