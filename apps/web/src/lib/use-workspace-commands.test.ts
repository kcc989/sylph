import { describe, expect, test } from "bun:test"

import {
  emptyWorkspaceCommandState,
  reduceWorkspaceCommandState,
} from "./use-workspace-commands"

describe("Workspace command state", () => {
  test("tracks concurrent commands and their targets", () => {
    let state = emptyWorkspaceCommandState()
    state = reduceWorkspaceCommandState(state, {
      type: "started",
      command: { command: "prompt", target: null },
    })
    state = reduceWorkspaceCommandState(state, {
      type: "started",
      command: { command: "answerQuestion", target: "question-1" },
    })
    state = reduceWorkspaceCommandState(state, {
      type: "started",
      command: { command: "prompt", target: null },
    })

    expect(state.pending).toEqual([
      { command: "prompt", target: null },
      { command: "answerQuestion", target: "question-1" },
    ])

    state = reduceWorkspaceCommandState(state, {
      type: "finished",
      command: { command: "prompt", target: null },
    })
    expect(state.pending).toEqual([
      { command: "answerQuestion", target: "question-1" },
    ])
  })

  test("starting a command clears the previous error and failing records one", () => {
    let state = reduceWorkspaceCommandState(emptyWorkspaceCommandState(), {
      type: "failed",
      command: { command: "checkpoint", target: null },
      message: "Checkpoint failed",
    })
    expect(state.error).toEqual({
      command: "checkpoint",
      message: "Checkpoint failed",
    })

    state = reduceWorkspaceCommandState(state, {
      type: "started",
      command: { command: "review", target: null },
    })
    expect(state.error).toBeNull()
    state = reduceWorkspaceCommandState(state, {
      type: "failed",
      command: { command: "review", target: null },
      message: "The review could not be updated",
    })
    expect(state).toEqual({
      pending: [],
      error: {
        command: "review",
        message: "The review could not be updated",
      },
    })
  })
})
