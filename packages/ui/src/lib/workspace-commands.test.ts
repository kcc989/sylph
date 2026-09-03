import { describe, expect, test } from "bun:test"

import {
  emptyWorkspaceCommandState,
  isWorkspaceCommandPending,
  pendingWorkspaceCommandTarget,
  workspaceCommandErrorExcept,
  workspaceCommandErrorMessage,
  workspaceCommandFailed,
  workspaceCommandFinished,
  workspaceCommandStarted,
} from "./workspace-commands"

describe("Workspace command state", () => {
  test("tracks concurrent commands and their targets", () => {
    let state = emptyWorkspaceCommandState()
    state = workspaceCommandStarted(state, { command: "prompt", target: null })
    state = workspaceCommandStarted(state, {
      command: "answerQuestion",
      target: "question-1",
    })
    state = workspaceCommandStarted(state, { command: "prompt", target: null })

    expect(state.pending).toHaveLength(2)
    expect(isWorkspaceCommandPending(state.pending, "prompt")).toBe(true)
    expect(isWorkspaceCommandPending(state.pending, "checkpoint")).toBe(false)
    expect(pendingWorkspaceCommandTarget(state.pending, "answerQuestion")).toBe(
      "question-1"
    )

    state = workspaceCommandFinished(state, { command: "prompt", target: null })
    expect(isWorkspaceCommandPending(state.pending, "prompt")).toBe(false)
    expect(isWorkspaceCommandPending(state.pending, "answerQuestion")).toBe(
      true
    )
  })

  test("starting a command clears the previous error and failing records one", () => {
    let state = workspaceCommandFailed(
      emptyWorkspaceCommandState(),
      { command: "checkpoint", target: null },
      "Checkpoint failed"
    )
    expect(state.error).toEqual({
      command: "checkpoint",
      message: "Checkpoint failed",
    })
    expect(workspaceCommandErrorMessage(state.error, "checkpoint")).toBe(
      "Checkpoint failed"
    )
    expect(workspaceCommandErrorMessage(state.error, "review")).toBeNull()
    expect(workspaceCommandErrorExcept(state.error, "review")).toBe(
      "Checkpoint failed"
    )
    expect(workspaceCommandErrorExcept(state.error, "checkpoint")).toBeNull()

    state = workspaceCommandStarted(state, { command: "review", target: null })
    expect(state.error).toBeNull()
    state = workspaceCommandFailed(
      state,
      { command: "review", target: null },
      "The review could not be updated"
    )
    expect(state.pending).toEqual([])
    expect(workspaceCommandErrorMessage(state.error, "review")).toBe(
      "The review could not be updated"
    )
  })
})
