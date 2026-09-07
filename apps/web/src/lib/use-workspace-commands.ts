import { failureMessage } from "@workspace/domain"
import { useCallback, useReducer } from "react"

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

type WorkspacePendingCommand = {
  readonly command: WorkspaceCommandName
  readonly target: string | null
}

type WorkspaceCommandState = {
  readonly pending: ReadonlyArray<WorkspacePendingCommand>
  readonly error: {
    readonly command: WorkspaceCommandName
    readonly message: string
  } | null
}

export type WorkspaceCommandStateChange =
  | { type: "started"; command: WorkspacePendingCommand }
  | { type: "finished"; command: WorkspacePendingCommand }
  | { type: "failed"; command: WorkspacePendingCommand; message: string }

export const emptyWorkspaceCommandState = (): WorkspaceCommandState => ({
  pending: [],
  error: null,
})

const sameCommand = (
  left: WorkspacePendingCommand,
  right: WorkspacePendingCommand
) => left.command === right.command && left.target === right.target

export const reduceWorkspaceCommandState = (
  state: WorkspaceCommandState,
  change: WorkspaceCommandStateChange
): WorkspaceCommandState => {
  if (change.type === "started") {
    return {
      pending: state.pending.some((item) => sameCommand(item, change.command))
        ? state.pending
        : [...state.pending, change.command],
      error: null,
    }
  }

  const pending = state.pending.filter(
    (item) => !sameCommand(item, change.command)
  )
  return change.type === "failed"
    ? {
        pending,
        error: { command: change.command.command, message: change.message },
      }
    : { ...state, pending }
}

export type WorkspaceCommandOptions = {
  readonly target?: string | null
  readonly refresh?: boolean
  readonly refreshOnFailure?: boolean
}

export const useWorkspaceCommands = (refresh: () => Promise<void>) => {
  const [state, changeState] = useReducer(
    reduceWorkspaceCommandState,
    undefined,
    emptyWorkspaceCommandState
  )

  const run = useCallback(
    async (
      command: WorkspaceCommandName,
      action: () => Promise<void>,
      fallback: string,
      options: WorkspaceCommandOptions = {}
    ) => {
      const started = { command, target: options.target ?? null }
      changeState({ type: "started", command: started })
      try {
        await action()
        if (options.refresh !== false) await refresh()
        changeState({ type: "finished", command: started })
        return true
      } catch (cause) {
        if (options.refreshOnFailure) await refresh().catch(() => undefined)
        changeState({
          type: "failed",
          command: started,
          message: failureMessage(cause, fallback),
        })
        return false
      }
    },
    [refresh]
  )

  return {
    errorExcept: (command: WorkspaceCommandName) =>
      state.error && state.error.command !== command
        ? state.error.message
        : null,
    errorFor: (command: WorkspaceCommandName) =>
      state.error?.command === command ? state.error.message : null,
    isPending: (command: WorkspaceCommandName) =>
      state.pending.some((item) => item.command === command),
    pendingTarget: (command: WorkspaceCommandName) =>
      state.pending.find((item) => item.command === command)?.target ?? null,
    run,
  }
}
