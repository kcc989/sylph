import { expect, test, spyOn } from "bun:test"
import { Cause, Effect } from "effect"
import { openCodeLogging } from "../../apps/web/src/server/opencode-logging"

test("runtime logging keeps provider causes available for redaction", async () => {
  const output = spyOn(console, "error").mockImplementation(() => {})
  try {
    await Effect.runPromise(
      Effect.logError(
        "Failed to drain Session",
        Cause.fail({
          reason: { raw: "TypeError: stream fixture; token=private-value" },
        })
      ).pipe(Effect.provide(openCodeLogging))
    )
    expect(output).toHaveBeenCalledWith(
      "Failed to drain Session",
      "TypeError: stream fixture; token=[redacted]"
    )
  } finally {
    output.mockRestore()
  }
})

test("runtime logging includes redacted plugin load failures", async () => {
  const output = spyOn(console, "error").mockImplementation(() => {})
  try {
    await Effect.runPromise(
      Effect.logWarning("failed to load plugin", {
        "plugin.id": "provider.openrouter",
        cause: Cause.die(new Error("Could not load; token=private-value")),
      }).pipe(Effect.provide(openCodeLogging))
    )
    expect(output.mock.calls[0]?.[0]).toContain("provider.openrouter")
    expect(output.mock.calls[0]?.[0]).toContain("token=[redacted]")
    expect(output.mock.calls[0]?.[0]).not.toContain("private-value")
  } finally {
    output.mockRestore()
  }
})
