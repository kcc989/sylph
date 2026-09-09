import type { ConnectOutcome, ReadOutcome } from "./installation"

export type ConnectState =
  | { status: "checking" }
  | { status: "editing" }
  | { status: "connecting" }
  | { status: "failed"; message: string }

export const initialConnectState: ConnectState = { status: "checking" }

export const connectingState: ConnectState = { status: "connecting" }

export const submittedAddress = (value: string) => value.trim()

export const canSubmit = (value: string, state: ConnectState) =>
  submittedAddress(value).length > 0 &&
  (state.status === "editing" || state.status === "failed")

export const submitLabel = (state: ConnectState) =>
  state.status === "connecting" ? "Connecting…" : "Connect"

export const failureMessage = (state: ConnectState) =>
  state.status === "failed" ? state.message : null

export const stateAfterRead = (outcome: ReadOutcome): ConnectState => {
  if (outcome.status === "connected") return connectingState
  if (outcome.status === "rejected") {
    return { status: "failed", message: outcome.error.message }
  }
  return { status: "editing" }
}

export const stateAfterConnect = (outcome: ConnectOutcome): ConnectState =>
  outcome.status === "connected"
    ? connectingState
    : { status: "failed", message: outcome.error.message }

export const stateAfterEdit = (state: ConnectState): ConnectState =>
  state.status === "failed" ? { status: "editing" } : state
