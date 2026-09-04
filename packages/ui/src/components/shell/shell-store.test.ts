import { describe, expect, test } from "bun:test"

import {
  createShellStore,
  setMobileNavigationOpen,
  setNavigationCollapsed,
} from "./shell-store"

const createStorage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

describe("shell store", () => {
  test("uses the initial navigation state without storage", () => {
    expect(createShellStore(true).state.navigationCollapsed).toBe(true)
  })

  test("restores and persists the shared navigation state", () => {
    const storage = createStorage()
    const first = createShellStore(false, storage)

    setNavigationCollapsed(first, true, storage)

    expect(createShellStore(false, storage).state.navigationCollapsed).toBe(
      true
    )
  })

  test("opens and closes mobile navigation", () => {
    const store = createShellStore(false)

    setMobileNavigationOpen(store, true)
    expect(store.state.mobileNavigationOpen).toBe(true)

    setMobileNavigationOpen(store, false)
    expect(store.state.mobileNavigationOpen).toBe(false)
  })
})
