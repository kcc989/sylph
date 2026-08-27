import { describe, expect, test } from "bun:test"

import { workspaceRuntimeStatus } from "./workspace-runtime-status"

describe("Workspace runtime status", () => {
  test("is running while the latest assistant message is incomplete", () => {
    expect(
      workspaceRuntimeStatus(true, [
        { type: "assistant", time: { created: 1 } },
      ])
    ).toBe("running")
  })

  test("is ready once the latest assistant message is complete", () => {
    expect(
      workspaceRuntimeStatus(true, [
        { type: "assistant", time: { created: 1, completed: 2 } },
      ])
    ).toBe("ready")
  })

  test("remains running when another user message is queued", () => {
    expect(
      workspaceRuntimeStatus(true, [
        { type: "assistant", time: { created: 1, completed: 2 } },
        { type: "user", time: { created: 3 } },
      ])
    ).toBe("running")
  })
})
