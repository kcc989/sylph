import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"

import { WorkspaceId } from "./ids"
import { decodeWorkspaceSummary } from "./workspace"

describe("WorkspaceSummary", () => {
  test("decodes a valid workspace summary", async () => {
    const summary = await Effect.runPromise(
      decodeWorkspaceSummary({
        id: "workspace-1",
        projectId: "project-1",
        title: "Set up CI",
        status: "ready",
      })
    )

    expect(summary.id).toBe(WorkspaceId.make("workspace-1"))
    expect(summary.status).toBe("ready")
  })

  test("rejects an empty title", async () => {
    const exit = await Effect.runPromiseExit(
      decodeWorkspaceSummary({
        id: "workspace-1",
        projectId: "project-1",
        title: "",
        status: "ready",
      })
    )

    expect(Exit.isFailure(exit)).toBe(true)
  })
})
