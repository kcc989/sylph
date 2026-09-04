import { describe, expect, test } from "bun:test"

import { workspaceRuntimeStatus } from "./workspace-runtime-status"

describe("Workspace runtime status", () => {
  test("keeps the turn running until OpenCode releases the active session", () => {
    expect(workspaceRuntimeStatus(true)).toBe("running")
    expect(workspaceRuntimeStatus(true, "succeeded")).toBe("running")
    expect(workspaceRuntimeStatus(true, "failed")).toBe("running")
    expect(workspaceRuntimeStatus(true, "interrupted")).toBe("running")
  })

  test("allows another prompt after success or failure", () => {
    expect(workspaceRuntimeStatus(false)).toBe("ready")
    expect(workspaceRuntimeStatus(false, "succeeded")).toBe("ready")
    expect(workspaceRuntimeStatus(false, "failed")).toBe("ready")
  })

  test("reports interruption once OpenCode releases the active session", () => {
    expect(workspaceRuntimeStatus(false, "interrupted")).toBe("interrupted")
  })
})
