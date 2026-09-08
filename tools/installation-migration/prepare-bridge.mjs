import { execFileSync } from "node:child_process"
import { cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const sourceCommit = "5311a147464946a7f0b781737166ea81d9c91f78"
const destination = process.argv[2]
if (!destination)
  throw new Error("Pass a new directory for the reviewed source bridge overlay")
const output = resolve(destination)
await mkdir(output, { recursive: false })
const historical = (path) =>
  execFileSync("git", ["show", `${sourceCommit}:${path}`], { encoding: "utf8" })
const write = async (path, value) => {
  const target = resolve(output, path)
  await mkdir(resolve(target, ".."), { recursive: true })
  await writeFile(target, value, { flag: "wx" })
}
for (const name of ["workspace-worker", "worker"]) {
  const path = `apps/web/src/${name}.ts`
  const exports = historical(path)
    .split("\n")
    .filter(
      (line) => line.startsWith("export {") && !line.includes("WorkspaceDO")
    )
  if (name === "workspace-worker")
    exports.push(
      'export { WorkspaceDO } from "../../../tools/installation-migration/bridge"'
    )
  exports.push(
    'export { default } from "../../../tools/installation-migration/bridge"'
  )
  await write(path, `${exports.join("\n")}\n`)
}
let alchemy = historical("alchemy.run.ts")
const env = `env: {\n        MIGRATION_TOKEN: Config.redacted("SYLPH_INSTALLATION_MIGRATION_TOKEN"),\n        MIGRATION_MODE: "source",\n        MIGRATION_DATABASE_ID: Config.string("SYLPH_INSTALLATION_MIGRATION_DATABASE_ID"),\n        MIGRATION_NAMESPACE_ID: Config.string("SYLPH_INSTALLATION_MIGRATION_NAMESPACE_ID"),`
alchemy = alchemy
  .replaceAll("env: {", env)
  .replace('crons: ["15 * * * *", "* * * * *"]', "crons: []")
await write("alchemy.run.ts", alchemy)
await mkdir(resolve(output, "tools/installation-migration/sources"), {
  recursive: true,
})
for (const name of [
  "bridge.ts",
  "workspace-storage.ts",
  "structured-value.ts",
  "d1-inventory.ts",
  "sources/workspace-schema.json",
  "sources/workspace-migrations.json",
])
  await cp(
    new URL(name, import.meta.url),
    resolve(output, "tools/installation-migration", name),
    { errorOnExist: true, force: false }
  )
await write(
  "packages/domain/src/installation-migration.ts",
  await readFile(
    new URL(
      "../../packages/domain/src/installation-migration.ts",
      import.meta.url
    ),
    "utf8"
  )
)
await write(
  "REVIEW.json",
  `${JSON.stringify({ sourceCommit, purpose: "Source freeze and authenticated SQL/KV export only", retained: ["All original Worker resources", "All original Durable Object class exports", "All original namespaces", "All original D1 data"], requiredBeforeDeploy: ["Review exact Alchemy plan for unchanged namespace/resource IDs", "Drain CI, repository operations, provisioning, merge, message workflows, sessions, alarms, outbox and check completion jobs", "Bind a dedicated migration token and exact database/namespace IDs", "Preserve all non-Workspace external storage and Workers separately"], promotion: "No namespace transfer or cleanup is included" }, null, 2)}\n`
)
console.log(
  `Prepared bridge overlay for review at ${output}; no deployment performed`
)
