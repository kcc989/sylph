import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Entry, Match } from "@opencode-ai/schema/filesystem"
import { RelativePath } from "@opencode-ai/schema/schema"
import { Effect, Layer } from "effect"
import ignore from "ignore"
import { Minimatch } from "minimatch"
import { RE2JS } from "re2js"

import {
  normalizeWorkspacePath,
  WorkspaceFilesystem,
} from "./workspace-filesystem"

const maximumSearchBytes = 16 * 1024 * 1024
const encoder = new TextEncoder()
const decoder = new TextDecoder()

const globMatcher = (pattern: string) => {
  if (pattern.length > 4096) throw new Error("Search pattern is too long")
  return new Minimatch(pattern.replace(/^\//, ""), {
    dot: true,
    matchBase: !pattern.includes("/"),
    nocomment: true,
    nonegate: true,
    noext: true,
  })
}

export const workspaceSearchLayer = (filesystem: WorkspaceFilesystem) => {
  const entries = async (
    input: Ripgrep.GlobInput & { exclude?: readonly string[] }
  ) => {
    input.signal?.throwIfAborted()
    const directory = normalizeWorkspacePath(input.cwd)
    const info = await filesystem.stat(directory)
    if (!info.isDirectory()) throw new Error("Search path must be a directory")
    const prefix = directory ? `${directory}/` : ""
    const paths = filesystem.listWorkingFiles()
    const rules = await Promise.all(
      paths
        .filter((path) => /(^|\/)(\.gitignore|\.ignore)$/.test(path))
        .map(async (path) => ({
          prefix: path.slice(0, path.lastIndexOf("/") + 1),
          matcher: ignore().add(
            String(await filesystem.readFile(path, "utf8"))
          ),
        }))
    )
    const pattern = globMatcher(input.pattern)
    const excluded = (input.exclude ?? []).map(globMatcher)
    return paths
      .filter((path) => {
        input.signal?.throwIfAborted()
        if (!path.startsWith(prefix) || path.split("/").includes(".git"))
          return false
        const relative = path.slice(prefix.length)
        if (
          !input.hidden &&
          relative.split("/").some((part) => part.startsWith("."))
        )
          return false
        if (
          rules.some(
            (rule) =>
              path.startsWith(rule.prefix) &&
              rule.matcher.ignores(path.slice(rule.prefix.length))
          )
        )
          return false
        return (
          pattern.match(relative) &&
          !excluded.some((matcher) => matcher.match(relative))
        )
      })
      .map((path) =>
        Entry.make({
          path: RelativePath.make(path.slice(prefix.length)),
          type: "file",
        })
      )
  }

  const glob: Ripgrep.Interface["glob"] = Effect.fn("WorkspaceSearch.glob")(
    (input) =>
      Effect.tryPromise({
        try: async () => (await entries(input)).slice(0, input.limit),
        catch: (cause) =>
          new Ripgrep.Error({ message: "Workspace file search failed", cause }),
      })
  )

  const find: Ripgrep.Interface["find"] = Effect.fn("WorkspaceSearch.find")(
    function* (input) {
      const found = yield* Effect.tryPromise({
        try: async () => (await entries(input)).slice(0, input.limit),
        catch: (cause) =>
          new Ripgrep.Error({ message: "Workspace file search failed", cause }),
      })
      if (input.onEntry)
        yield* Effect.forEach(found, input.onEntry, { discard: true })
      return found
    }
  )

  const grep: Ripgrep.Interface["grep"] = Effect.fn("WorkspaceSearch.grep")(
    function* (input) {
      const expression = yield* Effect.try({
        try: () => {
          if (input.pattern.length > 4096)
            throw new Error("Search pattern is too long")
          return RE2JS.compile(input.pattern)
        },
        catch: (cause) =>
          new Ripgrep.InvalidPatternError({
            pattern: input.pattern,
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      })
      return yield* Effect.tryPromise({
        try: async () => {
          const directory = normalizeWorkspacePath(input.cwd)
          const prefix = directory ? `${directory}/` : ""
          const file =
            input.file === undefined
              ? undefined
              : normalizeWorkspacePath(
                  input.file.startsWith("/")
                    ? input.file
                    : `${prefix}${input.file}`
                )
          if (file !== undefined && !file.startsWith(prefix))
            throw new Error("File must be inside the search directory")
          if (input.limit <= 0) return []
          const candidates =
            file !== undefined
              ? [
                  Entry.make({
                    path: RelativePath.make(file.slice(prefix.length)),
                    type: "file",
                  }),
                ]
              : await entries({
                  ...input,
                  pattern: input.include ?? "**/*",
                  hidden: true,
                })
          const matches: Match[] = []
          let scanned = 0
          for (const entry of candidates) {
            input.signal?.throwIfAborted()
            const path = `${prefix}${entry.path}`
            if (path.split("/").includes(".git"))
              throw new Error("Search cannot read Git metadata")
            const info = await filesystem.stat(path)
            scanned += info.size
            if (scanned > maximumSearchBytes)
              throw new Error(
                "Search exceeds 16 MiB; narrow the path or include pattern"
              )
            const content = await filesystem.readFile(path)
            const bytes =
              content instanceof Uint8Array ? content : encoder.encode(content)
            if (bytes.includes(0)) continue
            const text = decoder.decode(bytes)
            let offset = 0
            let line = 0
            for (const row of text.matchAll(/[^\n]*(?:\n|$)/g)) {
              if (!row[0]) continue
              input.signal?.throwIfAborted()
              line++
              const value = row[0]
              const matcher = expression.matcher(
                value.endsWith("\n") ? value.slice(0, -1) : value
              )
              const submatches: Array<Match["submatches"][number]> = []
              while (submatches.length < 100 && matcher.find()) {
                submatches.push({
                  text: matcher.group() ?? "",
                  start: encoder.encode(value.slice(0, matcher.start())).length,
                  end: encoder.encode(value.slice(0, matcher.end())).length,
                })
              }
              if (submatches.length)
                matches.push(
                  Match.make({
                    entry,
                    line,
                    offset,
                    text:
                      value.length > 2000
                        ? `${value.slice(0, 2000)}...`
                        : value,
                    submatches,
                  })
                )
              if (matches.length >= input.limit) return matches
              offset += encoder.encode(value).length
            }
          }
          return matches
        },
        catch: (cause) =>
          new Ripgrep.Error({
            message:
              cause instanceof Error
                ? cause.message
                : "Workspace text search failed",
            cause,
          }),
      })
    }
  )

  return Layer.succeed(Ripgrep.Service, { glob, find, grep })
}
