import { describe, expect, test } from "bun:test"
import { workspaceRuntimeStatus } from "./workspace-runtime-status"

describe("Workspace runtime status", () => {
  test("keeps the composer active between completed tool messages", () => {
    expect(workspaceRuntimeStatus(true)).toBe("running")
    expect(workspaceRuntimeStatus(true, "succeeded")).toBe("running")
    expect(workspaceRuntimeStatus(true, "interrupted")).toBe("running")
  })

  test("allows a new prompt after execution stops", () => {
    expect(workspaceRuntimeStatus(false, "succeeded")).toBe("ready")
    expect(workspaceRuntimeStatus(false, "failed")).toBe("ready")
    expect(workspaceRuntimeStatus(false, "interrupted")).toBe("interrupted")
  })
})
