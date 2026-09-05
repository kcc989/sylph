import { Database, type SQLQueryBindings } from "bun:sqlite"
import { expect, test } from "bun:test"
import { RelativePath } from "@opencode-ai/schema/schema"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Effect } from "effect"
import { WorkspaceFilesystem } from "./workspace-filesystem"
import { workspaceSearchLayer } from "./workspace-search"

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

const setup = async () => {
  const filesystem = new WorkspaceFilesystem(storage())
  filesystem.initialize()
  for (const [path, content] of Object.entries({
    ".gitignore": "ignored/\n",
    ".hidden.ts": "hidden needle\n",
    "src/one.ts": "é needle needle\nsecond needle\n",
    "src/two.ts": "no match\n",
    "src/nested/.gitignore": "excluded.ts\n",
    "src/nested/excluded.ts": "needle\n",
    "ignored/secret.ts": "needle\n",
    "binary.dat": "needle\0binary",
    ".git/config": "needle\n",
  }))
    await filesystem.writeFile(path, content)
  return { filesystem, layer: workspaceSearchLayer(filesystem) }
}

test("native glob uses durable files, scoped paths, hidden settings, ignores, and limits", async () => {
  const { layer } = await setup()
  await Effect.runPromise(
    Effect.gen(function* () {
      const search = yield* Ripgrep.Service
      expect(
        (yield* search.glob({
          cwd: "/workspace",
          pattern: "*.ts",
          limit: 10,
        })).map((entry) => String(entry.path))
      ).toEqual(["src/one.ts", "src/two.ts"])
      expect(
        (yield* search.glob({
          cwd: "/workspace/src",
          pattern: "*.ts",
          limit: 1,
        })).map((entry) => String(entry.path))
      ).toEqual(["one.ts"])
      expect(
        (yield* search.glob({
          cwd: "/workspace",
          pattern: ".hidden.ts",
          hidden: true,
          limit: 10,
        })).map((entry) => String(entry.path))
      ).toEqual([".hidden.ts"])
      const delivered: string[] = []
      const found = yield* search.find({
        cwd: "/workspace",
        pattern: "*.ts",
        exclude: ["**/two.ts"],
        limit: 10,
        onEntry: (entry) =>
          Effect.sync(() => {
            delivered.push(entry.path)
          }),
      })
      expect(found.map((entry) => String(entry.path))).toEqual(delivered)
      expect(delivered).toEqual(["src/one.ts"])
    }).pipe(Effect.provide(layer))
  )
})

test("native grep returns line numbers and UTF-8 byte offsets without binary or ignored files", async () => {
  const { layer } = await setup()
  await Effect.runPromise(
    Effect.gen(function* () {
      const search = yield* Ripgrep.Service
      const matches = yield* search.grep({
        cwd: "/workspace/src",
        pattern: "needle",
        limit: 10,
      })
      expect(matches).toHaveLength(2)
      expect(matches[0]).toEqual({
        entry: { path: RelativePath.make("one.ts"), type: "file" },
        line: 1,
        offset: 0,
        text: "é needle needle\n",
        submatches: [
          { text: "needle", start: 3, end: 9 },
          { text: "needle", start: 10, end: 16 },
        ],
      })
      expect(matches[1]?.offset).toBe(17)
      expect(
        yield* search.grep({
          cwd: "/workspace",
          pattern: "needle",
          include: "src/*.ts",
          limit: 1,
        })
      ).toHaveLength(1)
      expect(
        yield* search.grep({
          cwd: "/workspace",
          pattern: "needle",
          file: "binary.dat",
          limit: 10,
        })
      ).toEqual([])
    }).pipe(Effect.provide(layer))
  )
})

test("native search rejects invalid patterns, external paths, and cancellation", async () => {
  const { layer } = await setup()
  await Effect.runPromise(
    Effect.gen(function* () {
      const search = yield* Ripgrep.Service
      expect(
        yield* search
          .grep({ cwd: "/workspace", pattern: "[", limit: 1 })
          .pipe(Effect.flip)
      ).toMatchObject({ _tag: "Ripgrep.InvalidPatternError" })
      expect(
        yield* search
          .glob({ cwd: "/etc", pattern: "*", limit: 1 })
          .pipe(Effect.flip)
      ).toMatchObject({ _tag: "Ripgrep.Error" })
      expect(
        yield* search
          .grep({
            cwd: "/workspace/src",
            file: "../../etc/passwd",
            pattern: ".",
            limit: 1,
          })
          .pipe(Effect.flip)
      ).toMatchObject({ _tag: "Ripgrep.Error" })
      expect(
        yield* search
          .grep({
            cwd: "/workspace",
            file: ".git/config",
            pattern: ".",
            limit: 1,
          })
          .pipe(Effect.flip)
      ).toMatchObject({ _tag: "Ripgrep.Error" })
      expect(
        yield* search
          .glob({
            cwd: "/workspace",
            pattern: "*",
            limit: 1,
            signal: AbortSignal.abort(),
          })
          .pipe(Effect.flip)
      ).toMatchObject({ _tag: "Ripgrep.Error" })
    }).pipe(Effect.provide(layer))
  )
})

test("native grep handles nested repetition without backtracking and observes subsequent edits", async () => {
  const { filesystem, layer } = await setup()
  await filesystem.writeFile("large.txt", "a".repeat(32000) + "!")
  const run = () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const search = yield* Ripgrep.Service
        return yield* search.grep({
          cwd: "/workspace",
          file: "large.txt",
          pattern: "^(a+)+$",
          limit: 1,
        })
      }).pipe(Effect.provide(layer))
    )
  expect(await run()).toEqual([])
  await filesystem.writeFile("large.txt", "aaa")
  expect(await run()).toHaveLength(1)
})
