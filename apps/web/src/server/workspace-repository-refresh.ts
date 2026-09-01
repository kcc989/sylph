import {
  decodeWorkspaceCheckpointList,
  decodeWorkspaceVersionControl,
} from "@workspace/domain"

export const workspaceVersionControlRequest = () =>
  "https://workspace/vcs?refresh=1"

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

export const readWorkspaceVersionControl = async (
  read: () => Promise<Response>,
  options: WorkspaceVersionControlReadOptions = defaultReadOptions
) => {
  for (let attempt = 0; attempt < options.attempts; attempt += 1) {
    const response = await read()
    if (response.ok) return response

    const failure = new Error(await response.text())
    const initializing =
      response.status === 409 &&
      failure.message.includes("Workspace version control is not initialized")
    if (!initializing || attempt + 1 === options.attempts) throw failure

    await options.delay()
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
