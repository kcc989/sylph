import { failureMessage } from "@workspace/domain"
import {
  emptyWorkspaceCommandState,
  workspaceCommandFailed,
  workspaceCommandFinished,
  workspaceCommandStarted,
  type WorkspaceCommandName,
} from "@workspace/ui/lib/workspace-commands"
import { useCallback, useState } from "react"

export type WorkspaceCommandOptions = {
  readonly target?: string | null
  readonly refresh?: boolean
}

export const useWorkspaceCommands = (refresh: () => Promise<void>) => {
  const [state, setState] = useState(emptyWorkspaceCommandState)

  const run = useCallback(
    async (
      command: WorkspaceCommandName,
      action: () => Promise<void>,
      fallback: string,
      options: WorkspaceCommandOptions = {}
    ) => {
      const started = { command, target: options.target ?? null }
      setState((current) => workspaceCommandStarted(current, started))
      try {
        await action()
        if (options.refresh !== false) await refresh()
        setState((current) => workspaceCommandFinished(current, started))
        return true
      } catch (cause) {
        setState((current) =>
          workspaceCommandFailed(
            current,
            started,
            failureMessage(cause, fallback)
          )
        )
        return false
      }
    },
    [refresh]
  )

  return { pending: state.pending, error: state.error, run }
}
