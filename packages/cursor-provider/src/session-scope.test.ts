import { expect, test } from "bun:test"
import {
  createSessionScope,
  createScopedReadableStream,
  getSessionManager,
} from "cursor-opencode-provider/session"

test("user scopes isolate continuation managers across awaits and stream pulls", async () => {
  const first = createSessionScope()
  const second = createSessionScope()
  const firstManager = first.run(getSessionManager)
  const secondManager = second.run(getSessionManager)
  expect(firstManager).not.toBe(secondManager)
  const results = await Promise.all([
    first.run(async () => {
      await Promise.resolve()
      return getSessionManager()
    }),
    second.run(async () => {
      await Promise.resolve()
      return getSessionManager()
    }),
  ])
  expect(results).toEqual([firstManager, secondManager])
  const stream = first.run(() =>
    createScopedReadableStream({
      pull(controller) {
        controller.enqueue(getSessionManager())
        controller.close()
      },
    })
  )
  const result = await second.run(() => stream.getReader().read())
  expect(result.value).toBe(firstManager)
  first.dispose()
  second.dispose()
})
