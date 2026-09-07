import { afterEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import {
  cleanupFailureReason,
  cleanupSmokeRuns,
  smokeRuns,
} from "./cleanup.mjs"

const roots: string[] = []

async function worktree() {
  const root = await mkdtemp(resolve(tmpdir(), "sylph-cleanup-"))
  roots.push(root)
  return root
}

async function run(root: string, stage: string, status = "deployed") {
  const directory = resolve(root, ".alchemy/smoke-runs", stage)
  await mkdir(directory, { recursive: true })
  const record = {
    stage,
    status,
    environmentPath: resolve(directory, "deploy.env"),
  }
  await writeFile(record.environmentPath, 'CF_TOKEN="saved-token"\n')
  await writeFile(resolve(directory, "run.json"), JSON.stringify(record))
  return record
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

test("preview is local and never destroys resources or reads credentials", async () => {
  const root = await worktree()
  const record = await run(root, "smoke-old")
  await rm(record.environmentPath)
  const messages: string[] = []
  await cleanupSmokeRuns(
    root,
    {},
    () => {
      throw new Error("Must not execute")
    },
    (message: string) => messages.push(message)
  )
  expect(messages.join("\n")).toContain("smoke-old")
  expect(messages.join("\n")).toContain("--yes")
  expect((await smokeRuns(root))[0].record.status).toBe("deployed")
})

test("explicit cleanup selects one local stage and reuses its snapshot", async () => {
  const root = await worktree()
  const record = await run(root, "smoke-selected", "deploying")
  await run(root, "smoke-keep")
  const elsewhere = await worktree()
  await run(elsewhere, "smoke-elsewhere")
  const calls: string[][] = []
  await cleanupSmokeRuns(
    root,
    { yes: true, stage: record.stage },
    (args: string[], env: Record<string, string>) => {
      calls.push(args)
      expect(env.CF_TOKEN).toBe("saved-token")
    },
    () => {}
  )
  expect(calls).toEqual([
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
  ])
  expect((await smokeRuns(root, record.stage))[0].record.status).toBe(
    "destroyed"
  )
  expect((await smokeRuns(root, "smoke-keep"))[0].record.status).toBe(
    "deployed"
  )
  expect((await smokeRuns(elsewhere))[0].record.status).toBe("deployed")
  expect(await readFile(record.environmentPath, "utf8")).toContain(
    "saved-token"
  )
})

test("cleanup continues after failure and retries only unfinished stages", async () => {
  const root = await worktree()
  await run(root, "smoke-a")
  await run(root, "smoke-b")
  const messages: string[] = []
  await expect(
    cleanupSmokeRuns(
      root,
      { yes: true },
      (args: string[]) => {
        if (args.includes("smoke-a")) throw new Error("private-token")
      },
      (message: string) => messages.push(message)
    )
  ).rejects.toThrow("Cleanup failed: smoke-a")
  expect(messages.join("\n")).not.toContain("private-token")
  expect((await smokeRuns(root)).map(({ record }) => record.status)).toEqual([
    "destroy-failed",
    "destroyed",
  ])
  const retried: string[][] = []
  await cleanupSmokeRuns(
    root,
    { yes: true },
    (args: string[]) => retried.push(args),
    () => {}
  )
  expect(retried).toHaveLength(1)
  expect(retried[0]).toContain("smoke-a")
})

test("rejects unsafe or mismatched stages before calling Alchemy", async () => {
  const root = await worktree()
  const record = await run(root, "smoke-safe")
  const recordPath = resolve(record.environmentPath, "../run.json")
  for (const stage of ["prod", "smoke-other"]) {
    await writeFile(recordPath, JSON.stringify({ ...record, stage }))
    await expect(
      cleanupSmokeRuns(
        root,
        { yes: true },
        () => {
          throw new Error("Must not execute")
        },
        () => {}
      )
    ).rejects.toThrow()
  }
  await expect(smokeRuns(root, "../prod")).rejects.toThrow("Stage must start")
})

test("missing snapshots stop the whole batch before destruction", async () => {
  const root = await worktree()
  await run(root, "smoke-a")
  const record = await run(root, "smoke-b")
  await rm(record.environmentPath)
  let calls = 0
  await expect(
    cleanupSmokeRuns(
      root,
      { yes: true },
      () => {
        calls += 1
      },
      () => {}
    )
  ).rejects.toThrow()
  expect(calls).toBe(0)
})

test("empty worktrees are valid but unknown selected stages fail", async () => {
  const root = await worktree()
  expect(await smokeRuns(root)).toEqual([])
  await expect(smokeRuns(root, "smoke-missing")).rejects.toThrow()
})

test("an unsupported run selector cannot widen cleanup to all stages", async () => {
  const root = await worktree()
  await run(root, "smoke-keep")
  let calls = 0
  await expect(
    cleanupSmokeRuns(
      root,
      { yes: true, run: "/tmp/run.json" },
      () => {
        calls += 1
      },
      () => {}
    )
  ).rejects.toThrow("--stage")
  expect(calls).toBe(0)
})

test("non-empty bucket failures explain why a retry alone will not work", () => {
  expect(
    cleanupFailureReason("BucketNotEmpty: private-error-details")
  ).toContain("Empty the exact smoke-stage buckets")
  expect(
    cleanupFailureReason("BucketNotEmpty: private-error-details")
  ).not.toContain("private-error-details")
  expect(cleanupFailureReason("OtherError: private-token")).not.toContain(
    "private-token"
  )
})
