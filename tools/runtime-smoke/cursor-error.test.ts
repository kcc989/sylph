import { expect, test } from "bun:test"
import { connectFrameError } from "../../node_modules/cursor-opencode-provider/dist/language-model.js"

test("Cursor preserves a bounded server rejection without credentials", () => {
  const error = connectFrameError(
    JSON.stringify({
      error: {
        code: "invalid_argument",
        message:
          "Invalid model. Bearer credential token=private sk-private " +
          "x".repeat(2000),
      },
    })
  )
  expect(error.message).toContain("invalid_argument")
  expect(error.message).toContain("Invalid model.")
  expect(error.message).not.toContain("credential")
  expect(error.message).not.toContain("private")
  expect(error.message.length).toBeLessThan(1100)
})

test("Cursor retains the code when the server has no message", () => {
  expect(
    connectFrameError('{"error":{"code":"invalid_argument"}}').message
  ).toBe("Cursor API error (code=invalid_argument)")
})
