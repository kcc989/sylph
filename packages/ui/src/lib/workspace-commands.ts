export type WorkspaceCommandName =
  | "prompt"
  | "cancelTurn"
  | "answerQuestion"
  | "permissionReply"
  | "archive"
  | "discard"
  | "checkpoint"
  | "accept"
  | "restart"
  | "rebase"
  | "check"
  | "review"
  | "deploy"

export type WorkspacePendingCommand = {
  readonly command: WorkspaceCommandName
  readonly target: string | null
}

export type WorkspaceCommandError = {
  readonly command: WorkspaceCommandName
  readonly message: string
}

export type WorkspaceCommandState = {
  readonly pending: ReadonlyArray<WorkspacePendingCommand>
  readonly error: WorkspaceCommandError | null
}

export const emptyWorkspaceCommandState = (): WorkspaceCommandState => ({
  pending: [],
  error: null,
})

const samePending = (
  left: WorkspacePendingCommand,
  right: WorkspacePendingCommand
) => left.command === right.command && left.target === right.target

export const workspaceCommandStarted = (
  state: WorkspaceCommandState,
  started: WorkspacePendingCommand
): WorkspaceCommandState => ({
  pending: state.pending.some((item) => samePending(item, started))
    ? state.pending
    : [...state.pending, started],
  error: null,
})

export const workspaceCommandFinished = (
  state: WorkspaceCommandState,
  finished: WorkspacePendingCommand
): WorkspaceCommandState => ({
  ...state,
  pending: state.pending.filter((item) => !samePending(item, finished)),
})

export const workspaceCommandFailed = (
  state: WorkspaceCommandState,
  failed: WorkspacePendingCommand,
  message: string
): WorkspaceCommandState => ({
  pending: state.pending.filter((item) => !samePending(item, failed)),
  error: { command: failed.command, message },
})

export const isWorkspaceCommandPending = (
  pending: ReadonlyArray<WorkspacePendingCommand>,
  command: WorkspaceCommandName
) => pending.some((item) => item.command === command)

export const pendingWorkspaceCommandTarget = (
  pending: ReadonlyArray<WorkspacePendingCommand>,
  command: WorkspaceCommandName
) => pending.find((item) => item.command === command)?.target ?? null

export const workspaceCommandErrorMessage = (
  error: WorkspaceCommandError | null | undefined,
  command: WorkspaceCommandName
) => (error?.command === command ? error.message : null)

export const workspaceCommandErrorExcept = (
  error: WorkspaceCommandError | null | undefined,
  command: WorkspaceCommandName
) => (error && error.command !== command ? error.message : null)
