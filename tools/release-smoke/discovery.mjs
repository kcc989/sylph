import * as Schema from "effect/Schema"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { resolve } from "node:path"
import { parseEnv } from "node:util"
import {
  configurationPath,
  requireSmokeStage,
  serializeEnvironment,
} from "./config.mjs"
import { destroySmokeRuns, smokeRuns } from "./cleanup.mjs"

export function worktreePaths(output) {
  return [
    ...new Set(
      output
        .split("\0")
        .filter((field) => field.startsWith("worktree "))
        .map((field) => field.slice(9))
    ),
  ]
}

export async function remoteSmokeStages(
  configuration,
  request = fetch,
  home = homedir()
) {
  const account = configuration.CLOUDFLARE_ACCOUNT_ID
  if (!/^[a-f0-9]{32}$/.test(account || ""))
    throw new Error("Saved smoke configuration needs CLOUDFLARE_ACCOUNT_ID")
  const profile = configuration.ALCHEMY_PROFILE || "default"
  if (!/^[a-zA-Z0-9_-]+$/.test(profile))
    throw new Error("Invalid ALCHEMY_PROFILE")
  let credentials
  try {
    credentials = JSON.parse(
      await readFile(
        resolve(
          home,
          ".alchemy/credentials",
          profile,
          "cloudflare-state-store.json"
        ),
        "utf8"
      )
    )
  } catch {
    throw new Error(
      `No readable Cloudflare state credentials for Alchemy profile ${profile}. Sign in to that profile before discovery.`
    )
  }
  if (credentials.accountId !== account)
    throw new Error(
      "Alchemy state credentials do not match the saved Cloudflare account. Refresh that profile before discovery."
    )
  const url = new URL(credentials.url)
  if (
    url.protocol !== "https:" ||
    !/^alchemy-state-store\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    !credentials.authToken
  )
    throw new Error("Invalid Cloudflare state store credentials")
  const response = await request(new URL("/state/stacks/Sylph/stages", url), {
    headers: { Authorization: `Bearer ${credentials.authToken}` },
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok)
    throw new Error(
      `Alchemy stage discovery failed (HTTP ${response.status}); no cleanup performed`
    )
  const stages = Schema.decodeUnknownSync(Schema.Array(Schema.String))(
    await response.json()
  )
  return [...new Set(stages.filter((stage) => stage.startsWith("smoke-")))]
    .map(requireSmokeStage)
    .sort()
}

export async function discoverSmokeRuns(
  roots,
  stages,
  configuration,
  report = console.log
) {
  const candidates = new Map()
  for (const root of roots) {
    for (const run of await smokeRuns(root)) {
      if (!stages.includes(run.record.stage)) continue
      let snapshot
      try {
        snapshot = parseEnv(await readFile(run.record.environmentPath, "utf8"))
      } catch (error) {
        if (error.code !== "ENOENT") throw error
        report(
          `Missing snapshot for ${run.record.stage} in ${root}; using saved smoke configuration if no other snapshot exists`
        )
        continue
      }
      if (
        snapshot.CLOUDFLARE_ACCOUNT_ID !== configuration.CLOUDFLARE_ACCOUNT_ID
      ) {
        report(`Skipping record from another account: ${run.recordPath}`)
        continue
      }
      const previous = candidates.get(run.record.stage)
      if (
        previous &&
        serializeEnvironment(previous.configuration) !==
          serializeEnvironment(snapshot)
      )
        throw new Error(
          `Conflicting snapshots for ${run.record.stage}; resolve duplicate records before cleanup`
        )
      candidates.set(run.record.stage, {
        ...run,
        configuration: snapshot,
        source: root,
      })
    }
  }
  return stages.map(
    (stage) =>
      candidates.get(stage) || {
        record: { stage, status: "discovered", branch: null },
        configuration,
        source: "remote Alchemy state; no local snapshot",
      }
  )
}

export async function cleanupAllSmokeRuns(
  root,
  options,
  execute,
  report = console.log,
  discover = remoteSmokeStages
) {
  if (options.run)
    throw new Error("Cleanup selects runs with --stage, not --run")
  if (options.stage) requireSmokeStage(options.stage)
  const path = configurationPath(process.env)
  const configuration = parseEnv(await readFile(path, "utf8"))
  const stages = await discover(configuration)
  const selected = options.stage
    ? stages.filter((stage) => stage === options.stage)
    : stages
  if (options.stage && selected.length === 0)
    throw new Error(
      `No deployed Sylph stage ${options.stage} in the configured account`
    )
  const roots = worktreePaths(
    await execute(
      ["git", "worktree", "list", "--porcelain", "-z"],
      process.env,
      true
    )
  )
  const runs = await discoverSmokeRuns(roots, selected, configuration, report)
  report(
    `Cloudflare account: ${configuration.CLOUDFLARE_ACCOUNT_ID}; stack: Sylph; ${roots.length} worktrees scanned`
  )
  for (const run of runs)
    report(
      `${run.record.stage} | ${run.record.branch || "branch unrecorded"} | ${run.source}`
    )
  if (!runs.length) {
    report("No smoke stages in this account's Sylph state.")
    return
  }
  if (!options.yes) {
    report(
      `Preview: ${runs.length} smoke stage(s). Destroy: bun run smoke:release:cleanup -- --all${options.stage ? ` --stage ${options.stage}` : ""} --yes. This deletes their Alchemy-managed resources and data. Stop active deployments and tests first.`
    )
    return
  }
  const cleanupDirectory = resolve(
    root,
    ".alchemy/smoke-cleanup",
    configuration.CLOUDFLARE_ACCOUNT_ID
  )
  await mkdir(cleanupDirectory, { recursive: true, mode: 0o700 })
  const lockPath = resolve(cleanupDirectory, "cleanup.lock")
  await mkdir(lockPath, { mode: 0o700 })
  try {
    const prepared = []
    for (const run of runs) {
      const directory = resolve(
        root,
        ".alchemy/smoke-cleanup",
        configuration.CLOUDFLARE_ACCOUNT_ID,
        run.record.stage
      )
      await mkdir(directory, { recursive: true, mode: 0o700 })
      const environmentPath = resolve(directory, "deploy.env")
      const snapshot = {
        ...run.configuration,
        ALCHEMY_PROFILE: configuration.ALCHEMY_PROFILE || "default",
      }
      await writeFile(environmentPath, serializeEnvironment(snapshot), {
        mode: 0o600,
      })
      const record = {
        ...run.record,
        environmentPath,
        source: run.source,
        status: "discovered",
      }
      const recordPath = resolve(directory, "run.json")
      await writeFile(recordPath, JSON.stringify(record, null, 2), {
        mode: 0o600,
      })
      prepared.push({ record, recordPath, configuration: snapshot })
    }
    await destroySmokeRuns(prepared, execute, report, async (stage) => {
      if ((await discover(configuration)).includes(stage))
        throw new Error("Stage remains in remote state")
    })
  } finally {
    await rm(lockPath, { recursive: true })
  }
}
