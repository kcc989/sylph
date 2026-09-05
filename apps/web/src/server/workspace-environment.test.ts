import { Database, type SQLQueryBindings } from "bun:sqlite"
import { expect, test } from "bun:test"
import { Environment } from "@opencode-ai/core/environment/index"
import { Effect } from "effect"

import { workspaceEnvironmentLayer } from "./workspace-environment"
import { WorkspaceFilesystem } from "./workspace-filesystem"

const storage = () => {
  const database = new Database(":memory:")
  return {
    sql: {
      exec<Row extends Record<string, SqlStorageValue>>(
        query: string,
        ...parameters: SqlStorageValue[]
      ) {
        const rows = database
          .query<Row, SQLQueryBindings[]>(query)
          .all(
            ...parameters.map((value) =>
              value instanceof ArrayBuffer ? new Uint8Array(value) : value
            )
          )
        return { toArray: () => rows }
      },
    },
  }
}

test("native files use the durable working copy and survive adapter recreation", async () => {
  const durable = storage()
  const filesystem = new WorkspaceFilesystem(durable)
  filesystem.initialize()
  await filesystem.writeFile("src/todo.ts", "first\nsecond\n")
  const layer = workspaceEnvironmentLayer(filesystem, () => {})
  await Effect.runPromise(
    Effect.gen(function* () {
      const { files } = yield* Environment.Service
      expect(
        new TextDecoder().decode(
          (yield* files.read("/workspace/src/todo.ts")).bytes
        )
      ).toBe("first\nsecond\n")
      expect(
        new TextDecoder().decode(
          (yield* files.read("/workspace/src/todo.ts", {
            offset: 6,
            length: 6,
          })).bytes
        )
      ).toBe("second")
      expect(yield* files.list("/workspace")).toEqual([
        { name: "src", type: "directory" },
      ])
      yield* files.write(
        "/workspace/src/todo.ts",
        new TextEncoder().encode("changed\n")
      )
      yield* files.mkdir("/workspace/output")
      yield* files.move("/workspace/src/todo.ts", "/workspace/output")
      expect(yield* files.list("/workspace/src")).toEqual([])
    }).pipe(Effect.provide(layer))
  )
  expect(await filesystem.readFile("output/todo.ts", "utf8")).toBe("changed\n")
  const recovered = new WorkspaceFilesystem(durable)
  await Effect.runPromise(
    Effect.gen(function* () {
      const { files } = yield* Environment.Service
      expect(
        new TextDecoder().decode(
          (yield* files.read("/workspace/output/todo.ts")).bytes
        )
      ).toBe("changed\n")
      yield* files.remove("/workspace/output")
      yield* files.remove("/workspace/missing")
    }).pipe(Effect.provide(workspaceEnvironmentLayer(recovered, () => {})))
  )
  expect(recovered.listWorkingFiles()).toEqual([])
})

test("native file errors preserve missing paths, kind checks, and mutation guards", async () => {
  const filesystem = new WorkspaceFilesystem(storage())
  filesystem.initialize()
  await filesystem.writeFile("keep.txt", "keep")
  let writable = true
  const layer = workspaceEnvironmentLayer(filesystem, () => {
    if (!writable) throw new Error("Workspace is read-only")
  })
  await Effect.runPromise(
    Effect.gen(function* () {
      const { files } = yield* Environment.Service
      expect((yield* Effect.flip(files.read("/workspace/missing")))._tag).toBe(
        "Environment.NotFound"
      )
      expect((yield* Effect.flip(files.read("/workspace")))._tag).toBe(
        "Environment.WrongKind"
      )
      expect((yield* Effect.flip(files.list("/workspace/keep.txt")))._tag).toBe(
        "Environment.WrongKind"
      )
      for (const path of [
        "/outside.txt",
        "/workspace/../outside.txt",
        "/workspace/.git/HEAD",
      ]) {
        expect(
          (yield* Effect.flip(files.write(path, new Uint8Array([1]))))._tag
        ).toBe("Environment.Failed")
      }
      expect((yield* Effect.flip(files.remove("/workspace")))._tag).toBe(
        "Environment.Failed"
      )
      writable = false
      expect(
        (yield* Effect.flip(
          files.write("/workspace/keep.txt", new Uint8Array([1]))
        ))._tag
      ).toBe("Environment.Failed")
      expect(
        (yield* Effect.flip(files.remove("/workspace/keep.txt")))._tag
      ).toBe("Environment.Failed")
    }).pipe(Effect.provide(layer))
  )
  expect(await filesystem.readFile("keep.txt", "utf8")).toBe("keep")
})
