import {
  decodeWorkspaceCheckpointList,
  decodeWorkspaceVersionControl,
  decodeWorkspaceVersionControlSnapshot,
  type WorkspaceVersionControlSnapshot,
} from "@workspace/domain"

export const readCurrentProjectHead = <Value>(read: () => Promise<Value>) =>
  read()

type PersistedWorkspaceVersionControl = {
  defaultRef: string
  baseCommit: string | null
  forkHead: string | null
  syncStatus: string
  mergeStatus: string
}

export const readWorkspaceVersionControlSnapshot = async (
  snapshot: typeof WorkspaceVersionControlSnapshot.Encoded | null,
  persisted: PersistedWorkspaceVersionControl
) => {
  if (snapshot) {
    const decoded = await decodeWorkspaceVersionControlSnapshot(snapshot)
    return { versionControl: decoded.vcs, checkpoints: decoded.checkpoints }
  }

  if (!persisted.baseCommit || !persisted.forkHead) {
    throw new Error("Workspace version control is not initialized")
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
