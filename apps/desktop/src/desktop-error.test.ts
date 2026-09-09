import { describe, expect, test } from "bun:test"

import { commandChannelMessage, desktopError } from "./desktop-error"

describe("desktopError", () => {
  test("keeps the message of a rejected address", () => {
    expect(
      desktopError({
        kind: "invalidUrl",
        message:
          "Enter a full Installation address, for example https://sylph.example.workers.dev",
      })
    ).toEqual({
      kind: "invalidUrl",
      message:
        "Enter a full Installation address, for example https://sylph.example.workers.dev",
    })
  })

  test("keeps the message of an insecure scheme", () => {
    expect(
      desktopError({
        kind: "insecureScheme",
        message: "The Installation address must use HTTPS",
      }).kind
    ).toBe("insecureScheme")
  })

  test("keeps the message of a storage failure", () => {
    expect(
      desktopError({
        kind: "storage",
        message: "The Installation address was not saved: disk full",
      }).message
    ).toBe("The Installation address was not saved: disk full")
  })

  test("describes a rejection that carries no kind", () => {
    expect(
      desktopError({ message: "installation_connect not allowed" })
    ).toEqual({ kind: "storage", message: commandChannelMessage })
  })

  test("describes a rejection that carries no message", () => {
    expect(desktopError({ kind: "storage" })).toEqual({
      kind: "storage",
      message: commandChannelMessage,
    })
  })

  test("describes a missing rejection value", () => {
    expect(desktopError(null)).toEqual({
      kind: "storage",
      message: commandChannelMessage,
    })
  })
})
