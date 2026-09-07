import { afterEach, expect, test } from "bun:test"
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import {
  cleanupAllSmokeRuns,
  discoverSmokeRuns,
  remoteSmokeStages,
  worktreePaths,
} from "./discovery.mjs"
import { serializeEnvironment } from "./config.mjs"

const roots: string[] = []
const configuration = {
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  ALCHEMY_PROFILE: "smoke",
  CF_TOKEN: "saved-token",
}
const originalEnv = process.env.SYLPH_SMOKE_ENV_FILE

async function directory() {
  const root = await mkdtemp(resolve(tmpdir(), "sylph-discovery-"))
  roots.push(root)
  return root
}

async function localRun(root: string, stage: string, config = configuration) {
  const path = resolve(root, ".alchemy/smoke-runs", stage)
  await mkdir(path, { recursive: true })
  const environmentPath = resolve(path, "deploy.env")
  await writeFile(environmentPath, serializeEnvironment(config))
  await writeFile(
    resolve(path, "run.json"),
    JSON.stringify({
      stage,
      environmentPath,
      status: "deployed",
      branch: "codex/test",
    })
  )
}

async function credentials(accountId = configuration.CLOUDFLARE_ACCOUNT_ID) {
  const home = await directory()
  const path = resolve(home, ".alchemy/credentials/smoke")
  await mkdir(path, { recursive: true })
  await writeFile(
    resolve(path, "cloudflare-state-store.json"),
    JSON.stringify({
      accountId,
      url: "https://alchemy-state-store.test.workers.dev",
      authToken: "state-secret",
    })
  )
  return home
}

async function savedConfiguration() {
  const root = await directory()
  process.env.SYLPH_SMOKE_ENV_FILE = resolve(root, "saved.env")
  await writeFile(
    process.env.SYLPH_SMOKE_ENV_FILE,
    serializeEnvironment(configuration)
  )
  return root
}

afterEach(async () => {
  if (originalEnv === undefined) delete process.env.SYLPH_SMOKE_ENV_FILE
  else process.env.SYLPH_SMOKE_ENV_FILE = originalEnv
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

test("worktree discovery preserves spaces and removes duplicate paths", () => {
  expect(
    worktreePaths(
      "worktree /tmp/with spaces\0HEAD abc\0\0worktree /tmp/other\0detached\0\0worktree /tmp/other\0"
    )
  ).toEqual(["/tmp/with spaces", "/tmp/other"])
})

test("remote discovery makes only an authenticated read and excludes production", async () => {
  const home = await credentials()
  const stages = await remoteSmokeStages(
    configuration,
    async (url: URL, options: RequestInit) => {
      expect(url.pathname).toBe("/state/stacks/Sylph/stages")
      expect(options.method).toBeUndefined()
      expect(options.redirect).toBe("error")
      expect(options.headers).toEqual({ Authorization: "Bearer state-secret" })
      return Response.json(["prod", "dev", "smoke-b", "smoke-a", "smoke-b"])
    },
    home
  )
  expect(stages).toEqual(["smoke-a", "smoke-b"])
})

test("a mismatched state account fails before sending credentials", async () => {
  const home = await credentials("b".repeat(32))
  let requested = false
  await expect(
    remoteSmokeStages(
      configuration,
      async () => {
        requested = true
        return Response.json([])
      },
      home
    )
  ).rejects.toThrow("do not match")
  expect(requested).toBe(false)
})

test("remote discovery rejects failed, malformed, and unsafe responses", async () => {
  const home = await credentials()
  for (const response of [
    new Response(null, { status: 401 }),
    Response.json({ stages: [] }),
    Response.json(["smoke-../../prod"]),
  ]) {
    await expect(
      remoteSmokeStages(configuration, async () => response, home)
    ).rejects.toThrow()
  }
})

test("combines worktree snapshots and remote-only stages with account isolation", async () => {
  const first = await directory()
  const second = await directory()
  await localRun(first, "smoke-a")
  await localRun(second, "smoke-b")
  await localRun(second, "smoke-other-account", {
    ...configuration,
    CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
  })
  await localRun(first, "smoke-stale")
  const runs = await discoverSmokeRuns(
    [first, second],
    ["smoke-a", "smoke-b", "smoke-orphan", "smoke-other-account"],
    configuration,
    () => {}
  )
  expect(runs.map((run) => run.record.stage)).toEqual([
    "smoke-a",
    "smoke-b",
    "smoke-orphan",
    "smoke-other-account",
  ])
  expect(runs.map((run) => run.source)).toEqual([
    first,
    second,
    "remote Alchemy state; no local snapshot",
    "remote Alchemy state; no local snapshot",
  ])
  expect(runs[3].configuration.CLOUDFLARE_ACCOUNT_ID).toBe(
    configuration.CLOUDFLARE_ACCOUNT_ID
  )
})

test("conflicting snapshots fail without revealing credentials", async () => {
  const first = await directory()
  const second = await directory()
  await localRun(first, "smoke-a")
  await localRun(second, "smoke-a", {
    ...configuration,
    CF_TOKEN: "different-secret",
  })
  await expect(
    discoverSmokeRuns([first, second], ["smoke-a"], configuration)
  ).rejects.toThrow("Conflicting snapshots for smoke-a")
})

test("all preview does not destroy or write recovery records", async () => {
  const root = await savedConfiguration()
  const calls: string[][] = []
  await cleanupAllSmokeRuns(
    root,
    {},
    (args: string[]) => {
      calls.push(args)
      return `worktree ${root}\0`
    },
    () => {},
    async () => ["smoke-orphan"]
  )
  expect(calls).toEqual([["git", "worktree", "list", "--porcelain", "-z"]])
  expect(await readdir(root)).toEqual(["saved.env"])
})

test("all cleanup scopes a selected orphan, saves configuration, and verifies removal", async () => {
  const root = await savedConfiguration()
  let remote = ["smoke-a", "smoke-b"]
  const destroyed: string[] = []
  await cleanupAllSmokeRuns(
    root,
    { yes: true, stage: "smoke-a" },
    (args: string[], env: Record<string, string>) => {
      if (args[0] === "git") return `worktree ${root}\0`
      expect(env.CF_TOKEN).toBe("saved-token")
      expect(env.ALCHEMY_PROFILE).toBe("smoke")
      const stage = args[args.indexOf("--stage") + 1]
      destroyed.push(stage)
      remote = remote.filter((value) => value !== stage)
      return ""
    },
    () => {},
    async () => remote
  )
  expect(destroyed).toEqual(["smoke-a"])
  const record = JSON.parse(
    await readFile(
      resolve(
        root,
        ".alchemy/smoke-cleanup",
        configuration.CLOUDFLARE_ACCOUNT_ID,
        "smoke-a/run.json"
      ),
      "utf8"
    )
  )
  expect(record.status).toBe("destroyed")
  expect(await readFile(record.environmentPath, "utf8")).toContain(
    "saved-token"
  )
})

test("a successful process cannot claim cleanup while the remote stage remains", async () => {
  const root = await savedConfiguration()
  await expect(
    cleanupAllSmokeRuns(
      root,
      { yes: true },
      (args: string[]) => (args[0] === "git" ? `worktree ${root}\0` : ""),
      () => {},
      async () => ["smoke-a"]
    )
  ).rejects.toThrow("Cleanup failed: smoke-a")
  const record = JSON.parse(
    await readFile(
      resolve(
        root,
        ".alchemy/smoke-cleanup",
        configuration.CLOUDFLARE_ACCOUNT_ID,
        "smoke-a/run.json"
      ),
      "utf8"
    )
  )
  expect(record.status).toBe("destroy-failed")
})

test("failed discovery blocks every destructive command", async () => {
  const root = await savedConfiguration()
  let commands = 0
  await expect(
    cleanupAllSmokeRuns(
      root,
      { yes: true },
      () => {
        commands += 1
      },
      () => {},
      async () => {
        throw new Error("Unavailable")
      }
    )
  ).rejects.toThrow("Unavailable")
  expect(commands).toBe(0)
})
