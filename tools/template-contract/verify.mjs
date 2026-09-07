import { Schema } from "effect"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { pathToFileURL } from "node:url"

export const requiredTemplateScripts = [
  "typecheck",
  "lint",
  "test",
  "build",
  "sylph:plan",
  "sylph:preview",
  "sylph:deploy",
  "sylph:release:review",
  "sylph:release:prepare",
  "sylph:release:restore",
  "sylph:release:verify",
  "sylph:release:resume",
]

export const verifyTemplateManifest = (manifest) => {
  const missing = requiredTemplateScripts.filter(
    (name) =>
      !Schema.is(Schema.String)(manifest.scripts?.[name]) ||
      !manifest.scripts[name].trim()
  )
  if (missing.length)
    throw new Error(`Template contract missing scripts: ${missing.join(", ")}`)
}

export const verifyTemplateContract = (directory) => {
  const cwd = resolve(directory)
  verifyTemplateManifest(
    JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8"))
  )
  const prefix = `sylph-${"a".repeat(24)}`
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    SYLPH_RESOURCE_PREFIX: prefix,
    SYLPH_DEPLOYMENT: "preview",
  }
  const planned = spawnSync("bun", ["run", "sylph:plan"], {
    cwd,
    env,
    encoding: "utf8",
    timeout: 30_000,
  })
  if (planned.status !== 0)
    throw new Error(`Credential-free planning failed: ${planned.stderr}`)
  const receipts = planned.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith("SYLPH_RESOURCE_PLAN="))
  if (receipts.length !== 1)
    throw new Error("Planning must emit exactly one resource plan")
  const plan = JSON.parse(receipts[0].slice("SYLPH_RESOURCE_PLAN=".length))
  if (
    !Array.isArray(plan) ||
    plan.length === 0 ||
    plan.length > 20 ||
    plan.filter((resource) => resource.kind === "worker").length !== 1
  )
    throw new Error(
      "Template plan must declare one Worker and at most twenty resources"
    )
  const names = new Set()
  for (const resource of plan) {
    if (
      !["worker", "d1", "kv", "r2", "queue"].includes(resource.kind) ||
      !Schema.is(Schema.String)(resource.name) ||
      !resource.name.startsWith(`${prefix}-`) ||
      !/^[a-z0-9-]{1,63}$/.test(resource.name) ||
      names.has(resource.name)
    )
      throw new Error("Template resource plan violates the reserved namespace")
    names.add(resource.name)
  }
  for (const script of requiredTemplateScripts.filter((name) =>
    name.startsWith("sylph:release:")
  )) {
    const result = spawnSync("bun", ["run", script], {
      cwd,
      env,
      encoding: "utf8",
      timeout: 30_000,
    })
    if (
      result.status === 0 ||
      result.signal ||
      /SYLPH_(MIGRATION_REVIEW|RECOVERY_POINT|DATA_RESTORED|PRODUCTION_JOURNEY|WRITES_RESUMED)=/.test(
        result.stdout
      )
    )
      throw new Error(
        `${script} must reject absent release identity and credentials without emitting a success receipt`
      )
  }
  return plan
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  verifyTemplateContract(process.argv[2] ?? ".")
  console.log("Template script, planning, and missing-input contracts passed")
}
