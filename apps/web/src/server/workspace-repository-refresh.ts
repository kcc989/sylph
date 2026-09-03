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

export type WorkspaceVersionControlReadOptions = {
  attempts: number
  delay: () => Promise<void>
}

const defaultReadOptions: WorkspaceVersionControlReadOptions = {
  attempts: 100,
  delay: () => new Promise((resolve) => setTimeout(resolve, 100)),
}

export const waitForWorkspaceVersionControl = async (
  read: () => Promise<WorkspaceVersionControlSnapshot | null>,
  options: WorkspaceVersionControlReadOptions = defaultReadOptions
) => {
  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    const snapshot = await read()
    if (snapshot) return snapshot
    if (attempt + 1 < options.attempts) await options.delay()
  }
  throw new WorkspaceRuntimeFailure({
    message: "Workspace version control is not initialized",
    reason: "not_initialized",
  })
}

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
