import { describe, expect, test } from "bun:test"

import { createOpenCodeWithStorageBootstrap } from "./opencode-storage-bootstrap"

class TestStorage {
  readonly tables: Set<string>

  constructor(tables: string[]) {
    this.tables = new Set(tables)
  }

  readonly sql = {
    exec: (query: string) => {
      if (query.startsWith("SELECT name FROM sqlite_master")) {
        return {
          toArray: () =>
            [...this.tables]
              .filter((name) => !name.startsWith("sqlite_"))
              .sort()
              .map((name) => ({ name })),
        }
      }

      const rename = query.match(/^ALTER TABLE "([^"]+)" RENAME TO "([^"]+)"$/)
      if (!rename) throw new Error(`Unexpected SQL: ${query}`)
      const [, from, to] = rename
      if (!from || !to || !this.tables.delete(from)) {
        throw new Error(`Missing table: ${from}`)
      }
      this.tables.add(to)
      return { toArray: () => [] }
    },
  }
}

describe("OpenCode storage bootstrap", () => {
  test("hides Sylph tables while OpenCode initializes and restores them", async () => {
    const storage = new TestStorage([
      "app_workspace_file",
      "app_workspace_state",
    ])
    const result = await createOpenCodeWithStorageBootstrap(
      storage,
      async () => {
        expect([...storage.tables].sort()).toEqual([
          "_app_workspace_file",
          "_app_workspace_state",
        ])
        storage.tables.add("session_v2")
        return "ready"
      }
    )

    expect(result).toBe("ready")
    expect([...storage.tables].sort()).toEqual([
      "app_workspace_file",
      "app_workspace_state",
      "session_v2",
    ])
  })

  test("restores Sylph tables when OpenCode initialization fails", async () => {
    const storage = new TestStorage(["app_workspace_file"])

    await expect(
      createOpenCodeWithStorageBootstrap(storage, async () => {
        throw new Error("OpenCode failed")
      })
    ).rejects.toThrow("OpenCode failed")
    expect([...storage.tables]).toEqual(["app_workspace_file"])
  })

  test("recovers a hidden Sylph table left by an interrupted bootstrap", async () => {
    const storage = new TestStorage(["_app_workspace_file", "session_v2"])

    await createOpenCodeWithStorageBootstrap(storage, async () => "ready")
    expect([...storage.tables].sort()).toEqual([
      "app_workspace_file",
      "session_v2",
    ])
  })
})
