import {
  decodeWorkspaceCheckpointList,
  decodeWorkspaceVersionControl,
  decodeWorkspaceVersionControlSnapshot,
  type WorkspaceVersionControlSnapshot,
} from "@workspace/domain"

export const readCurrentProjectHead = <Value>(read: () => Promise<Value>) =>
  read()

export type WorkspaceVersionControlReadOptions = {
  attempts: number
  delay: () => Promise<void>
}

const defaultReadOptions: WorkspaceVersionControlReadOptions = {
  attempts: 100,
  delay: () => new Promise((resolve) => setTimeout(resolve, 100)),
}

export const waitForWorkspaceVersionControl = async (
  read: () => Promise<typeof WorkspaceVersionControlSnapshot.Encoded | null>,
  options: WorkspaceVersionControlReadOptions = defaultReadOptions
) => {
  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    const snapshot = await read()
    if (snapshot) return snapshot
    if (attempt + 1 < options.attempts) await options.delay()
  }
  throw new Error("Workspace version control is not initialized")
}

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
