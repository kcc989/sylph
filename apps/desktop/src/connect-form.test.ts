import { describe, expect, test } from "bun:test"

import {
  canSubmit,
  failureMessage,
  initialConnectState,
  stateAfterConnect,
  stateAfterEdit,
  stateAfterRead,
  submitLabel,
  submittedAddress,
} from "./connect-form"
import type { ConnectState } from "./connect-form"

const failed: ConnectState = {
  status: "failed",
  message: "Enter a valid address",
}

describe("submittedAddress", () => {
  test("removes surrounding whitespace", () => {
    expect(submittedAddress("  https://sylph.example  ")).toBe(
      "https://sylph.example"
    )
  })
})

describe("canSubmit", () => {
  test("waits for the saved address to be read", () => {
    expect(canSubmit("https://sylph.example", initialConnectState)).toBe(false)
  })

  test("rejects an address of only whitespace", () => {
    expect(canSubmit("   ", { status: "editing" })).toBe(false)
  })

  test("accepts an address once the read finished", () => {
    expect(canSubmit("https://sylph.example", { status: "editing" })).toBe(true)
  })

  test("rejects a second submission while connecting", () => {
    expect(canSubmit("https://sylph.example", { status: "connecting" })).toBe(
      false
    )
  })

  test("accepts a corrected address after a failure", () => {
    expect(canSubmit("https://sylph.example", failed)).toBe(true)
  })
})

describe("submitLabel", () => {
  test("names the action while the form is editable", () => {
    expect(submitLabel({ status: "editing" })).toBe("Connect")
  })

  test("reports progress while the command runs", () => {
    expect(submitLabel({ status: "connecting" })).toBe("Connecting…")
  })
})

describe("stateAfterRead", () => {
  test("opens the form when no Installation is saved", () => {
    expect(stateAfterRead({ status: "disconnected" })).toEqual({
      status: "editing",
    })
  })

  test("waits while the window moves to a saved Installation", () => {
    expect(
      stateAfterRead({
        status: "connected",
        installation: { origin: "https://sylph.example" },
      })
    ).toEqual({ status: "connecting" })
  })

  test("shows why the saved Installation could not be read", () => {
    expect(
      stateAfterRead({
        status: "rejected",
        error: {
          kind: "storage",
          message: "The config directory is unavailable",
        },
      })
    ).toEqual({
      status: "failed",
      message: "The config directory is unavailable",
    })
  })
})

describe("stateAfterConnect", () => {
  test("keeps connecting while the window navigates", () => {
    expect(
      stateAfterConnect({
        status: "connected",
        installation: { origin: "https://sylph.example" },
      })
    ).toEqual({ status: "connecting" })
  })

  test("shows the message of a rejected address", () => {
    expect(
      stateAfterConnect({
        status: "rejected",
        error: {
          kind: "insecureScheme",
          message: "The Installation address must use HTTPS",
        },
      })
    ).toEqual({
      status: "failed",
      message: "The Installation address must use HTTPS",
    })
  })

  test("shows the message of a storage failure", () => {
    expect(
      stateAfterConnect({
        status: "rejected",
        error: {
          kind: "storage",
          message: "The Installation address was not saved: disk full",
        },
      })
    ).toEqual({
      status: "failed",
      message: "The Installation address was not saved: disk full",
    })
  })
})

describe("stateAfterEdit", () => {
  test("clears the error when the address changes", () => {
    expect(stateAfterEdit(failed)).toEqual({ status: "editing" })
  })

  test("leaves an unfinished command alone", () => {
    const connecting: ConnectState = { status: "connecting" }
    expect(stateAfterEdit(connecting)).toBe(connecting)
  })
})

describe("failureMessage", () => {
  test("returns nothing while editing", () => {
    expect(failureMessage({ status: "editing" })).toBeNull()
  })

  test("returns nothing while connecting", () => {
    expect(failureMessage({ status: "connecting" })).toBeNull()
  })

  test("returns the failure text", () => {
    expect(failureMessage(failed)).toBe("Enter a valid address")
  })
})
