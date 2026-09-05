import { Environment } from "@opencode-ai/core/environment/index"
import { EnvironmentUnavailable } from "@opencode-ai/core/environment/unavailable"
import { Effect, Layer } from "effect"

import {
  normalizeWorkspacePath,
  WorkspaceFilesystem,
  workspaceFilesystemErrorCode,
} from "./workspace-filesystem"

const readFailure = (path: string, cause: unknown) =>
  workspaceFilesystemErrorCode(cause) === "ENOENT"
    ? new Environment.NotFound({ path })
    : new Environment.Failed({ path, cause })

export const workspaceEnvironmentLayer = (
  filesystem: WorkspaceFilesystem,
  assertWritable: () => void
) => {
  const assertMutation = (path: string) => {
    assertWritable()
    const relative = normalizeWorkspacePath(path)
    if (!relative || relative === ".git" || relative.startsWith(".git/")) {
      throw new Error("Native file tools cannot change Workspace Git metadata")
    }
  }

  const stat = Effect.fn("WorkspaceEnvironment.stat")(function* (path: string) {
    const info = yield* Effect.tryPromise({
      try: () => filesystem.stat(path),
      catch: (cause) => readFailure(path, cause),
    })
    return {
      type: info.isDirectory() ? "directory" : "file",
      size: info.size,
      mtimeMs: info.mtimeMs,
    } satisfies Environment.FileInfo
  })

  const read: Environment.Files["read"] = Effect.fn(
    "WorkspaceEnvironment.read"
  )(function* (path, range) {
    const info = yield* stat(path)
    if (info.type !== "file") {
      return yield* new Environment.WrongKind({ path, actual: info.type })
    }
    const content = yield* Effect.tryPromise({
      try: () => filesystem.readFile(path),
      catch: (cause) => readFailure(path, cause),
    })
    const bytes =
      content instanceof Uint8Array
        ? content
        : new TextEncoder().encode(content)
    return {
      info,
      bytes: range
        ? bytes.slice(range.offset, range.offset + range.length)
        : bytes,
    }
  })

  const list = Effect.fn("WorkspaceEnvironment.list")(function* (path: string) {
    const info = yield* stat(path)
    if (info.type !== "directory") {
      return yield* new Environment.WrongKind({ path, actual: info.type })
    }
    const names = yield* Effect.tryPromise({
      try: () => filesystem.readdir(path),
      catch: (cause) => readFailure(path, cause),
    })
    return yield* Effect.forEach(names, (name) =>
      stat(`${path}/${name}`).pipe(
        Effect.map((entry) => ({ name, type: entry.type }))
      )
    )
  })

  const write = Effect.fn("WorkspaceEnvironment.write")(
    (path: string, bytes: Uint8Array) =>
      Effect.tryPromise({
        try: async () => {
          assertMutation(path)
          await filesystem.writeFile(path, bytes)
        },
        catch: (cause) => new Environment.Failed({ path, cause }),
      })
  )

  const removePath = async (path: string): Promise<void> => {
    const info = await filesystem.stat(path)
    if (info.isDirectory()) {
      for (const name of await filesystem.readdir(path)) {
        await removePath(`${path}/${name}`)
      }
      await filesystem.rmdir(path)
    } else {
      await filesystem.unlink(path)
    }
  }

  const remove = Effect.fn("WorkspaceEnvironment.remove")((path: string) =>
    Effect.tryPromise({
      try: async () => {
        assertMutation(path)
        try {
          await removePath(path)
        } catch (cause) {
          if (workspaceFilesystemErrorCode(cause) !== "ENOENT") throw cause
        }
      },
      catch: (cause) => new Environment.Failed({ path, cause }),
    })
  )

  const mkdir = Effect.fn("WorkspaceEnvironment.mkdir")((path: string) =>
    Effect.tryPromise({
      try: async () => {
        if (!normalizeWorkspacePath(path)) return
        assertMutation(path)
        await filesystem.mkdir(path, { recursive: true })
      },
      catch: (cause) => new Environment.Failed({ path, cause }),
    })
  )

  const move = Effect.fn("WorkspaceEnvironment.move")(
    function* (from: string, to: string) {
      const source = yield* read(from)
      const destination = yield* stat(to).pipe(
        Effect.map((info) =>
          info.type === "directory"
            ? `${to}/${normalizeWorkspacePath(from).split("/").at(-1)}`
            : to
        ),
        Effect.catchTag("Environment.NotFound", () => Effect.succeed(to))
      )
      yield* Effect.try({
        try: () => {
          assertMutation(from)
          assertMutation(destination)
        },
        catch: (cause) => new Environment.Failed({ path: from, cause }),
      })
      if (
        normalizeWorkspacePath(from) === normalizeWorkspacePath(destination)
      ) {
        return
      }
      yield* write(destination, source.bytes)
      yield* remove(from)
    },
    Effect.mapError((cause) =>
      cause instanceof Environment.WrongKind
        ? new Environment.Failed({ path: cause.path, cause })
        : cause
    )
  )

  return Layer.succeed(Environment.Service, {
    files: { read, write, stat, list, remove, move, mkdir },
    spawner: EnvironmentUnavailable.spawner,
  })
}
