import { expect, test } from "bun:test"
import { CursorServerError } from "cursor-opencode-provider/errors"
import { cursorFailureMessage } from "./failure"

test("Cursor failures retain actionable provider detail without restarting host retries", () => {
  const failure = new CursorServerError("Selected variant is unavailable", {
    code: "invalid_argument",
    transient: false,
    replaySafe: false,
  })
  expect(cursorFailureMessage(failure)).toBe(
    "Selected variant is capacity_limit"
  )
})

test("Cursor transport omits arbitrary exception details", () => {
  expect(cursorFailureMessage(new Error("private transport detail"))).toBe(
    "Cursor model request failed"
  )
})
