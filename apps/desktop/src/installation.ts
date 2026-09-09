import { invoke } from "@tauri-apps/api/core"

import { desktopError } from "./desktop-error"
import type { CommandRejection, DesktopError } from "./desktop-error"

export type Installation = {
  origin: string
}

type RejectedCommand = {
  status: "rejected"
  error: DesktopError
}

export type ReadOutcome =
  | { status: "connected"; installation: Installation }
  | { status: "disconnected" }
  | RejectedCommand

export type ConnectOutcome =
  | { status: "connected"; installation: Installation }
  | RejectedCommand

export type DisconnectOutcome = { status: "disconnected" } | RejectedCommand

const rejectedCommand = (cause: CommandRejection): RejectedCommand => ({
  status: "rejected",
  error: desktopError(cause),
})

export const installationRead = (): Promise<ReadOutcome> =>
  invoke<Installation | null>("installation_read").then(
    (installation): ReadOutcome =>
      installation === null
        ? { status: "disconnected" }
        : { status: "connected", installation },
    (cause: CommandRejection): ReadOutcome => rejectedCommand(cause)
  )

export const installationConnect = (address: string): Promise<ConnectOutcome> =>
  invoke<Installation>("installation_connect", { address }).then(
    (installation): ConnectOutcome => ({ status: "connected", installation }),
    (cause: CommandRejection): ConnectOutcome => rejectedCommand(cause)
  )

export const installationDisconnect = (): Promise<DisconnectOutcome> =>
  invoke<null>("installation_disconnect").then(
    (): DisconnectOutcome => ({ status: "disconnected" }),
    (cause: CommandRejection): DisconnectOutcome => rejectedCommand(cause)
  )
