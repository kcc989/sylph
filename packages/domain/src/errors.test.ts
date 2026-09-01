import { describe, expect, test } from "bun:test"

import {
  AccessDenied,
  AuthenticationRequired,
  decodeServerFailure,
  encodeServerFailure,
  failureMessage,
  failureTag,
  isServerFailure,
  WorkspaceReadOnly,
} from "./errors"

describe("Server failures", () => {
  test("round-trip through their encoded form with the tag intact", () => {
    const failure = new AccessDenied({
      message: "This Workspace does not exist or you cannot access it",
      resource: "workspace",
    })

    const decoded = decodeServerFailure(
      JSON.parse(JSON.stringify(encodeServerFailure(failure)))
    )

    expect(decoded).toBeInstanceOf(AccessDenied)
    expect(decoded).toBeInstanceOf(Error)
    expect(decoded._tag).toBe("AccessDenied")
    expect(decoded.message).toBe(failure.message)
    expect(failureTag(decoded)).toBe("AccessDenied")
  })

  test("recognizes only domain failures", () => {
    expect(isServerFailure(new AuthenticationRequired({ message: "x" }))).toBe(
      true
    )
    expect(isServerFailure(new Error("x"))).toBe(false)
    expect(isServerFailure({ _tag: "AccessDenied", message: "x" })).toBe(false)
    expect(failureTag(new Error("x"))).toBeNull()
  })

  test("describes any failure with a fallback for unknown causes", () => {
    const readOnly = new WorkspaceReadOnly({
      message: "Archived Workspaces are read-only",
      status: "archived",
    })

    expect(failureMessage(readOnly, "fallback")).toBe(readOnly.message)
    expect(failureMessage(new Error("boom"), "fallback")).toBe("boom")
    expect(failureMessage(new Error(""), "fallback")).toBe("fallback")
    expect(failureMessage("string", "fallback")).toBe("fallback")
    expect(failureMessage(undefined, "fallback")).toBe("fallback")
  })
})
