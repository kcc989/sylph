import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { parseEnv } from "node:util"
import { requireSmokeStage } from "./config.mjs"

export async function smokeRuns(root, stage) {
  if (stage) requireSmokeStage(stage)
  const directory = resolve(root, ".alchemy/smoke-runs")
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error.code === "ENOENT" && !stage) return []
    throw error
  }
  const runs = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || (stage && entry.name !== stage)) continue
    const recordPath = resolve(directory, entry.name, "run.json")
    const record = JSON.parse(await readFile(recordPath, "utf8"))
    requireSmokeStage(record.stage)
    if (record.stage !== entry.name)
      throw new Error(`Stage does not match run directory: ${recordPath}`)
    if (record.environmentPath !== resolve(directory, entry.name, "deploy.env"))
      throw new Error(`Snapshot does not belong to this run: ${recordPath}`)
    runs.push({ record, recordPath })
  }
  if (stage && runs.length === 0)
    throw new Error(`No local run record for ${stage}`)
  return runs
}

export async function cleanupSmokeRuns(
  root,
  options,
  execute,
  report = console.log
) {
  if (options.run)
    throw new Error("Cleanup selects runs with --stage, not --run")
  const runs = await smokeRuns(root, options.stage)
  const pending = runs.filter(({ record }) => record.status !== "destroyed")
  for (const { record } of runs)
    report(
      `${record.stage} | ${record.status} | ${record.branch || "branch unrecorded"} | ${record.baseURL || "URL unrecorded"}`
    )
  if (pending.length === 0) {
    report("No smoke deployments to clean up in this worktree.")
    return
  }
  if (!options.yes) {
    report(
      `Preview: ${pending.length} smoke stage(s) in ${root}. Re-run with --yes to destroy these stages and their Alchemy-managed data. Stop any active deploy or test first.`
    )
    return
  }
  const prepared = await Promise.all(
    pending.map(async (run) => ({
      ...run,
      configuration: parseEnv(
        await readFile(run.record.environmentPath, "utf8")
      ),
    }))
  )
  await destroySmokeRuns(prepared, execute, report)
}

export function cleanupFailureReason(log) {
  if (log.includes("BucketNotEmpty"))
    return "R2 buckets still contain objects. Empty the exact smoke-stage buckets listed in destroy.log before retrying."
  return "Inspect destroy.log and resolve the failure before retrying."
}

export async function destroySmokeRuns(
  prepared,
  execute,
  report = console.log,
  verify = async () => {}
) {
  const failures = []
  for (const { record, recordPath, configuration } of prepared) {
    const lockPath = resolve(recordPath, "../cleanup.lock")
    await mkdir(lockPath, { mode: 0o700 })
    try {
      record.status = "destroying"
      await writeFile(recordPath, JSON.stringify(record, null, 2), {
        mode: 0o600,
      })
      try {
        await execute(
          [
            "bun",
            "alchemy",
            "destroy",
            "--env-file",
            record.environmentPath,
            "--stage",
            record.stage,
            "--yes",
          ],
          { ...process.env, ...configuration },
          true,
          resolve(recordPath, "../destroy.log")
        )
        await verify(record.stage)
        record.status = "destroyed"
        record.destroyedAt = new Date().toISOString()
        delete record.cleanupFailure
        report(`Destroyed ${record.stage}`)
      } catch {
        record.status = "destroy-failed"
        failures.push(record.stage)
        let log = ""
        try {
          log = await readFile(resolve(recordPath, "../destroy.log"), "utf8")
        } catch (error) {
          if (error.code !== "ENOENT") throw error
        }
        record.cleanupFailure = cleanupFailureReason(log)
        report(record.cleanupFailure)
        report(
          `Cleanup failed for ${record.stage}; inspect ${resolve(recordPath, "../destroy.log")}`
        )
      }
      await writeFile(recordPath, JSON.stringify(record, null, 2), {
        mode: 0o600,
      })
    } finally {
      await rm(lockPath, { recursive: true })
    }
  }
  if (failures.length)
    throw new Error(
      `Cleanup failed: ${failures.join(", ")}. Resolve the reported failures, then retry unfinished stages.`
    )
}
