import { describe, expect, test } from "bun:test"

import {
  AccessDenied,
  AuthenticationRequired,
  decodeServerFailure,
  encodeServerFailure,
  failureMessage,
  failureTag,
  isRuntimeNotInitialized,
  isServerFailure,
  parseServerFailure,
  runtimeFailure,
  serializeServerFailure,
  WorkspaceReadOnly,
  WorkspaceRuntimeFailure,
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

  test("crosses a message-only hop inside a failure envelope", () => {
    const readOnly = new WorkspaceReadOnly({
      message: "Archived Workspaces are read-only",
      status: "archived",
    })
    const arrived = new Error(serializeServerFailure(readOnly))

    const parsed = parseServerFailure(arrived.message)
    expect(parsed).toBeInstanceOf(WorkspaceReadOnly)
    expect(parsed?.message).toBe(readOnly.message)
    expect(parseServerFailure("plain text")).toBeNull()
    expect(parseServerFailure("@sylph/failure:{not json")).toBeNull()

    expect(runtimeFailure(arrived)).toBeInstanceOf(WorkspaceReadOnly)
    expect(runtimeFailure(readOnly)).toBe(readOnly)
    const wrapped = runtimeFailure(new Error("socket closed"))
    expect(wrapped).toBeInstanceOf(WorkspaceRuntimeFailure)
    expect(wrapped.message).toBe("socket closed")
    expect(runtimeFailure("string").message).toBe("Workspace runtime failed")
  })

  test("recognizes a runtime that has not initialized yet", () => {
    const notInitialized = new WorkspaceRuntimeFailure({
      message: "Workspace version control is not initialized",
      reason: "not_initialized",
    })
    expect(isRuntimeNotInitialized(notInitialized)).toBe(true)
    expect(
      isRuntimeNotInitialized(
        runtimeFailure(new Error(serializeServerFailure(notInitialized)))
      )
    ).toBe(true)
    expect(
      isRuntimeNotInitialized(new WorkspaceRuntimeFailure({ message: "x" }))
    ).toBe(false)
    expect(isRuntimeNotInitialized(new Error("x"))).toBe(false)
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
