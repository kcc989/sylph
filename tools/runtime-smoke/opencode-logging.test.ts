import { expect, test } from "bun:test"
import { Cause, Effect } from "effect"
import { layer } from "../../node_modules/@opencode-ai/sdk/dist/logging"
import { providerRuntimeErrorDetail } from "../../apps/web/src/server/workspace-error-summary"

test("SDK logging preserves the original provider failure for redacted diagnostics", async () => {
  const details: Array<string | null> = []
  const failure = {
    reason: { raw: "TypeError: stream fixture; token=private-value" },
  }
  await Effect.runPromise(
    Effect.logError("Failed to drain Session", Cause.fail(failure)).pipe(
      Effect.provide(
        layer({
          level: "error",
          emit: ({ cause }) => {
            details.push(providerRuntimeErrorDetail(cause))
          },
        })
      )
    )
  )
  expect(details).toEqual(["TypeError: stream fixture; token=[redacted]"])
})
