import { describe, expect, test } from "bun:test"

import {
  workspaceFileContainsNull,
  workspaceFileDisplayLimit,
  workspaceFileEncoding,
} from "./workspace-file-content"

describe("Workspace file content", () => {
  test("detects binary content from a NUL byte", () => {
    expect(workspaceFileContainsNull(new Uint8Array([65, 0, 66]))).toBe(true)
    expect(workspaceFileContainsNull(new Uint8Array([65, 66]))).toBe(false)
    expect(workspaceFileEncoding(3, new Uint8Array([65, 0, 66]))).toBe("binary")
  })

  test("rejects files above the display limit before reading content", () => {
    expect(workspaceFileEncoding(workspaceFileDisplayLimit + 1, null)).toBe(
      "too-large"
    )
  })

  test("allows text at the display limit", () => {
    expect(
      workspaceFileEncoding(
        workspaceFileDisplayLimit,
        new TextEncoder().encode("text")
      )
    ).toBe("utf8")
  })
})
