import { describe, expect, test } from "bun:test"
import {
  GitCommitId,
  WorkspaceCheckpoint,
  WorkspaceCheckpointResult,
} from "@workspace/domain"

import { serializableWorkspaceCheckpointResult } from "./workspace-checkpoint-result"

describe("Workspace checkpoint response", () => {
  test("returns a plain nested server-function payload", () => {
    const commit = GitCommitId.make("275f3f920c1a2252a29b7d19ea1908b5134d5896")
    const result = serializableWorkspaceCheckpointResult(
      new WorkspaceCheckpointResult({
        checkpoint: new WorkspaceCheckpoint({
          id: "checkpoint-1",
          commit,
          message: "Resolve conflict",
          createdAt: 1788144199000,
        }),
        replayed: false,
      })
    )

    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(result.checkpoint)).toBe(Object.prototype)
    expect(result).toEqual({
      checkpoint: {
        id: "checkpoint-1",
        commit,
        message: "Resolve conflict",
        createdAt: 1788144199000,
      },
      replayed: false,
    })
  })
})
