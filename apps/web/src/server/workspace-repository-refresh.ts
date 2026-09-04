import { Schema } from "effect"

import {
  type WorkspaceVersionControlSnapshot,
  WorkspaceRuntimeFailure,
  WorkspaceCheckpointList,
  WorkspaceVersionControl,
} from "@workspace/domain"

const decodeWorkspaceCheckpointList = Schema.decodeUnknownPromise(
  WorkspaceCheckpointList
)
const decodeWorkspaceVersionControl = Schema.decodeUnknownPromise(
  WorkspaceVersionControl
)

type PersistedWorkspaceVersionControl = {
  defaultRef: string
  baseCommit: string | null
  forkHead: string | null
  syncStatus: string
  mergeStatus: string
}

export const readWorkspaceVersionControlSnapshot = async (
  snapshot: WorkspaceVersionControlSnapshot | null,
  persisted: PersistedWorkspaceVersionControl
) => {
  if (snapshot) {
    return { versionControl: snapshot.vcs, checkpoints: snapshot.checkpoints }
  }

  if (!persisted.baseCommit || !persisted.forkHead) {
    throw new WorkspaceRuntimeFailure({
      message: "Workspace version control is not initialized",
      reason: "not_initialized",
    })
  }

  return {
    versionControl: await decodeWorkspaceVersionControl({
      defaultRef: persisted.defaultRef,
      currentRef: persisted.defaultRef,
      baseCommit: persisted.baseCommit,
      forkHead: persisted.forkHead,
      projectHead: persisted.baseCommit,
      projectChanged: false,
      syncStatus: persisted.syncStatus,
      mergeStatus: persisted.mergeStatus,
      working: [],
      branch: [],
    }),
    checkpoints: await decodeWorkspaceCheckpointList([]),
  }
}
