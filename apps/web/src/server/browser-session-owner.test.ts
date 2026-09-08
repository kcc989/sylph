import { expect, test } from "bun:test"

import { browserSessionOwner } from "./browser-session-owner"

const fixture = (idleTimeout = 60_000) => {
  let sequence = 0
  const closed: string[] = []
  const owner = browserSessionOwner(async () => {
    const id = String(++sequence)
    let connected = true
    return {
      id,
      connected: () => connected,
      detach() {
        connected = false
      },
      async close() {
        closed.push(id)
        connected = false
      },
    }
  }, idleTimeout)
  return { owner, closed }
}

test("reuses the guarded transport across action connections", async () => {
  const { owner, closed } = fixture()
  const first = await owner.acquire("preview")
  owner.release(first)
  expect(await owner.acquire("preview", first.id)).toBe(first)
  expect(closed).toEqual([])
  await owner.close()
  expect(closed).toEqual([first.id])
})

test("owner loss and policy changes expire authentication without replay", async () => {
  const { owner, closed } = fixture()
  const first = await owner.acquire("preview")
  first.detach()
  await expect(owner.acquire("preview", first.id)).rejects.toThrow(
    "Start a new session"
  )
  expect(closed).toEqual([first.id])
  const next = await owner.acquire("preview")
  await expect(owner.acquire("another-origin", next.id)).rejects.toThrow(
    "policy changed"
  )
  expect(closed).toEqual([first.id, next.id])
})

test("a reconstructed owner cannot adopt a session without its navigation guard", async () => {
  const first = fixture()
  const second = fixture()
  const session = await first.owner.acquire("preview")
  await expect(second.owner.acquire("preview", session.id)).rejects.toThrow(
    "owner disconnected"
  )
  await first.owner.close()
})

test("idle expiry closes the remote browser and stale release cannot close a replacement", async () => {
  const { owner, closed } = fixture(15)
  const first = await owner.acquire("preview")
  owner.release(first)
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(closed).toEqual([first.id])
  const second = await owner.acquire("preview")
  owner.release(first)
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(second.connected()).toBe(true)
  await owner.close()
  expect(closed).toEqual([first.id, second.id])
})
