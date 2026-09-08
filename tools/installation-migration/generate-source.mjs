import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import { Effect } from "effect"
import { migrations } from "@opencode-ai/core/database/migration.gen"
import schema from "@opencode-ai/core/database/schema.gen"

const commit = "5311a147464946a7f0b781737166ea81d9c91f78"
const statements = []
await Effect.runPromise(
  schema.up({
    run: (value) =>
      Effect.sync(() => {
        statements.push(value.trim())
      }),
  })
)
statements.push(
  "CREATE TABLE migration (id TEXT PRIMARY KEY, time_completed INTEGER NOT NULL);"
)
const files = [
  "workspace-filesystem",
  "workspace-git",
  "workspace-checks",
  "workspace-do",
]
const hashes = {}
for (const name of files) {
  const path = `apps/web/src/server/${name}.ts`
  const source = execFileSync("git", ["show", `${commit}:${path}`], {
    encoding: "utf8",
  })
  hashes[path] = createHash("sha256").update(source).digest("hex")
  for (const match of source.matchAll(
    /(?:"|`)\s*(CREATE TABLE IF NOT EXISTS app_[\s\S]*?)(?:"|`)/g
  )) {
    statements.push(`${match[1]};`)
  }
}
const sql = `${statements.join("\n")}\n`
writeFileSync(new URL("./sources/workspace-5311a14.sql", import.meta.url), sql)
writeFileSync(
  new URL("./sources/provenance.json", import.meta.url),
  `${JSON.stringify({ sourceCommit: commit, sdk: "@opencode-ai/core@0.0.0-dev-18308", files: hashes, workspaceSqlHash: createHash("sha256").update(sql).digest("hex") }, null, 2)}\n`
)

writeFileSync(
  new URL("./sources/workspace-migrations.json", import.meta.url),
  `${JSON.stringify(migrations.map((entry) => entry.id).sort(), null, 2)}\n`
)
