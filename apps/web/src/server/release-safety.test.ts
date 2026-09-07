import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ciCommand } from "./command-execution"
import { reserveDeploymentSql } from "./release-reservation"
import {
  releasePreflightCommand,
  releaseScripts,
  readMigrationReview,
  readRecoveryPoint,
  readProductionJourney,
} from "./release-safety"

const identity = {
  deploymentId: "release",
  projectId: "project",
  commit: "a".repeat(40),
  baseCommit: null,
}
const point = {
  ...identity,
  capturedAt: 1000,
  expiresAt: 10000,
  writesPaused: true,
  inventoryComplete: true,
  resources: [
    { id: "db", kind: "database", backupRef: "backup", restoreVerifiedAt: 900 },
  ],
}

test("recovery rejects missing coordination, incomplete inventory, and invalid backup evidence", () => {
  for (const changes of [
    { writesPaused: false },
    { inventoryComplete: false },
    { resources: [{ ...point.resources[0], backupRef: "" }] },
    { resources: [point.resources[0], point.resources[0]] },
    { projectId: "other" },
    { capturedAt: 1001 },
    { expiresAt: 999 },
    { commit: "b".repeat(40) },
  ]) {
    expect(() =>
      readRecoveryPoint(
        `SYLPH_RECOVERY_POINT=${JSON.stringify({ ...point, ...changes })}`,
        identity,
        1000
      )
    ).toThrow()
  }
  expect(
    readRecoveryPoint(
      `SYLPH_RECOVERY_POINT=${JSON.stringify(point)}`,
      identity,
      1000
    ).resources
  ).toHaveLength(1)
})

test("migration review and journeys are pinned to the release identity", () => {
  const review = {
    ...identity,
    compatible: true,
    evidence: "Tested migrations",
  }
  expect(() =>
    readMigrationReview(
      `SYLPH_MIGRATION_REVIEW=${JSON.stringify({ ...review, baseCommit: "b".repeat(40) })}`,
      identity
    )
  ).toThrow()
  const journey = {
    ...identity,
    url: "https://example.com",
    passed: true,
    journeys: [],
  }
  expect(() =>
    readProductionJourney(
      `SYLPH_PRODUCTION_JOURNEY=${JSON.stringify(journey)}`,
      identity,
      journey.url
    )
  ).toThrow()
  expect(() =>
    readRecoveryPoint(
      `SYLPH_RECOVERY_POINT=${JSON.stringify(point)}\nSYLPH_RECOVERY_POINT=${JSON.stringify(point)}`,
      identity,
      1000
    )
  ).toThrow()
})

test("production reservation serializes concurrent requests and rejects stale baselines", async () => {
  const db = new Database(":memory:")
  db.exec(
    "CREATE TABLE deployment (id TEXT PRIMARY KEY, project_id TEXT, [commit] TEXT, status TEXT, actor_user_id TEXT, created_at INTEGER, updated_at INTEGER)"
  )
  db.exec(
    await Bun.file(
      new URL(
        "../../../../packages/db/migrations/0024_release_safety.sql",
        import.meta.url
      )
    ).text()
  )
  const reserve = (id: string, baseline: string | null) =>
    db
      .query(reserveDeploymentSql)
      .run(
        id,
        "project",
        identity.commit,
        "admin",
        baseline,
        null,
        1000,
        1000,
        "project",
        "project",
        baseline
      ).changes
  expect(reserve("first", null)).toBe(1)
  expect(reserve("second", null)).toBe(0)
  db.exec("UPDATE deployment SET status = 'succeeded'")
  expect(reserve("second", null)).toBe(0)
  expect(reserve("second", "first")).toBe(1)
  db.close()
})

const pipeline = async (mode: string) => {
  const child = Bun.spawn(
    [
      process.execPath,
      new URL(
        "../../../../tools/ci-smoke/release-safety.fixture.mjs",
        import.meta.url
      ).pathname,
      mode,
    ],
    { stdout: "pipe", stderr: "pipe" }
  )
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect(stderr).toBe("")
  expect(code).toBe(0)
  return JSON.parse(stdout)
}

test("production saves recovery before publish and journeys before resuming writes", async () => {
  const result = await pipeline("success")
  expect(result.deployment.status).toBe("succeeded")
  expect(result.check.status).toBe("passed")
  expect(
    result.commands.map((command: { name: string }) => command.name)
  ).toEqual([
    "verification",
    "release-review",
    "release-prepare",
    "production",
    "production-journey",
    "release-resume",
    "production-journey-live",
  ])
  expect(
    result.commands.find(
      (command: { name: string }) => command.name === "production"
    ).deployment.recovery_json
  ).not.toBeNull()
  expect(
    result.commands.find(
      (command: { name: string }) => command.name === "release-resume"
    ).deployment.verification_json
  ).not.toBeNull()
  expect(result.selector).toContain(
    `data-sylph-checkpoint="${identity.commit}"`
  )
  expect(result.selector).toContain('data-sylph-deployment="production"')
  expect(result.artifacts).toHaveLength(2)
})

test.each([
  "incompatible",
  "missing-backup",
  "expired-backup",
  "backup-save-failure",
])("stops before publication: %s", async (mode) => {
  const result = await pipeline(mode)
  expect(result.deployment.status).toBe("failed")
  expect(
    result.commands.some(
      (command: { name: string }) => command.name === "production"
    )
  ).toBe(false)
})

test.each([
  "browser-failure",
  "wrong-commit",
  "resume-failure",
  "live-journey-failure",
])("retains the published URL without claiming success: %s", async (mode) => {
  const result = await pipeline(mode)
  expect(result.deployment.status).toBe("failed")
  expect(result.deployment.production_url).toBe(
    "https://app.account.workers.dev"
  )
  expect(result.check.status).toBe("failed")
  expect(
    result.check.stages.some(
      (stage: { status: string }) => stage.status === "failed"
    )
  ).toBe(true)
})

test.each(["restore-success", "restore-failure", "restore-incomplete"])(
  "coordinates restore with an undo point and verification: %s",
  async (mode) => {
    const result = await pipeline(mode)
    expect(result.deployment.status).toBe(
      mode === "restore-success" ? "succeeded" : "failed"
    )
    const restored = result.commands.find(
      (command: { name: string }) => command.name === "data-restore"
    )
    expect(restored.deployment.recovery_json).not.toBeNull()
    if (mode !== "restore-success")
      expect(
        result.commands.some(
          (command: { name: string }) => command.name === "production"
        )
      ).toBe(false)
  }
)

test("missing application hooks stop the actual CI command before mutations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sylph-release-preflight-"))
  try {
    await Bun.write(
      join(directory, "package.json"),
      JSON.stringify({ scripts: { "sylph:deploy": "echo deploy" } })
    )
    const missing = Bun.spawnSync(
      ["bash", "-c", ciCommand(releasePreflightCommand, true)],
      { cwd: directory }
    )
    expect(missing.exitCode).toBe(64)
    expect(missing.stderr.toString()).toContain("sylph:release:prepare")
    await Bun.write(
      join(directory, "package.json"),
      JSON.stringify({
        scripts: Object.fromEntries(
          releaseScripts.map((script) => [script, "echo integration-hook"])
        ),
      })
    )
    const ready = Bun.spawnSync(
      ["bash", "-c", ciCommand(releasePreflightCommand, true)],
      { cwd: directory }
    )
    expect(ready.exitCode).toBe(0)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("invalid receipts do not expose input values in diagnostics", () => {
  expect(() =>
    readRecoveryPoint(
      'SYLPH_RECOVERY_POINT={"secret":"must-not-appear"}',
      identity,
      1000
    )
  ).toThrow("Invalid release receipt. Check the release safety schema.")
})
