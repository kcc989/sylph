import { expect, test } from "bun:test"
import { reserveSmokeRequest, smokeModel } from "./workspace-smoke-budget"

const request = (body: { model: string; max_tokens?: number }) =>
  new Request("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    body: JSON.stringify(body),
  })

const ledger = () => {
  let reserved = 0
  return {
    transaction: async <T>(
      run: (storage: {
        get(key: string): Promise<number | undefined>
        put(key: string, value: number): Promise<void>
      }) => Promise<T>
    ) =>
      run({
        get: async () => reserved,
        put: async (_key, value) => {
          reserved = value
        },
      }),
    reserved: () => reserved,
  }
}

test("rejects another model and unbounded output before reserving money", async () => {
  const storage = ledger()
  await expect(
    reserveSmokeRequest(request({ model: "other", max_tokens: 4096 }), storage)
  ).rejects.toThrow("only Grok")
  await expect(
    reserveSmokeRequest(request({ model: smokeModel }), storage)
  ).rejects.toThrow("output limit")
  expect(storage.reserved()).toBe(0)
})

test("preserves a conservative budget across calls and stops before four dollars", async () => {
  const storage = ledger()
  const input = {
    model: smokeModel,
    max_tokens: 4096,
    messages: [{ role: "user", content: "a".repeat(100_000) }],
  }
  for (let count = 0; count < 16; count++)
    await reserveSmokeRequest(request(input), storage)
  await expect(reserveSmokeRequest(request(input), storage)).rejects.toThrow(
    "$4"
  )
  expect(storage.reserved()).toBeLessThanOrEqual(4_000_000)
})

test("allows larger tool histories only within the remaining reservation", async () => {
  const storage = ledger()
  const input = {
    model: smokeModel,
    max_tokens: 4096,
    messages: [{ role: "user", content: "a".repeat(256_000) }],
  }
  for (let count = 0; count < 7; count++)
    await reserveSmokeRequest(request(input), storage)
  const before = storage.reserved()
  await expect(reserveSmokeRequest(request(input), storage)).rejects.toThrow(
    "$4"
  )
  expect(storage.reserved()).toBe(before)
  expect(storage.reserved()).toBeLessThanOrEqual(4_000_000)
})

test("rejects a single request above the entire budget without a reservation", async () => {
  const storage = ledger()
  const input = {
    model: smokeModel,
    max_tokens: 4096,
    messages: [{ role: "user", content: "a".repeat(2_000_000) }],
  }
  await expect(reserveSmokeRequest(request(input), storage)).rejects.toThrow(
    "$4"
  )
  expect(storage.reserved()).toBe(0)
})
