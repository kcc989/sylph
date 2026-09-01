import {
  decodeWorkspaceCheckpointList,
  decodeWorkspaceVersionControl,
} from "@workspace/domain"

export const workspaceVersionControlRequest = () =>
  "https://workspace/vcs?refresh=1"

export const readCurrentProjectHead = <Value>(read: () => Promise<Value>) =>
  read()

type PersistedWorkspaceVersionControl = {
  defaultRef: string
  baseCommit: string | null
  forkHead: string | null
  syncStatus: string
  mergeStatus: string
}

export const readWorkspaceVersionControlResponse = async (
  response: Response,
  persisted: PersistedWorkspaceVersionControl
) => {
  if (response.ok) {
    const payload = await response.json<{
      vcs: unknown
      checkpoints: unknown
    }>()
    return {
      versionControl: await decodeWorkspaceVersionControl(payload.vcs),
      checkpoints: await decodeWorkspaceCheckpointList(payload.checkpoints),
    }
  }

  const message = await response.text()
  if (
    message.trim() !== "Workspace version control is not initialized" ||
    !persisted.baseCommit ||
    !persisted.forkHead
  ) {
    throw new Error(message)
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
