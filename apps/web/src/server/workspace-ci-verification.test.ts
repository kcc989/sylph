import { describe, expect, test } from "bun:test"

import {
  verificationCommand,
  verificationDurations,
  verificationFailureStage,
  failedCheckStages,
} from "./workspace-ci-verification"
import { checkStage } from "./workspace-checks"

test("a failed shared runner preserves completed stages and skips later work", () => {
  const result = Bun.spawnSync({
    cmd: [
      "sh",
      "-c",
      verificationCommand([
        { name: "install", command: "true" },
        { name: "typecheck", command: "exit 2" },
        { name: "lint", command: "true" },
        { name: "test", command: "true" },
      ]),
    ],
  })
  expect(result.exitCode).toBe(2)
  const stages = failedCheckStages(
    (["install", "typecheck", "lint", "test", "preview"] as const).map((name) =>
      checkStage(name, "queued", "Waiting")
    ),
    result.stdout.toString(),
    new Set(["typecheck"])
  )
  expect(stages.map((stage) => [stage.name, stage.status])).toEqual([
    ["install", "passed"],
    ["typecheck", "failed"],
    ["lint", "passed"],
    ["test", "skipped"],
    ["preview", "skipped"],
  ])
  expect(stages[0]?.durationMs).toBeGreaterThanOrEqual(0)
})

describe("Workspace CI verification", () => {
  test("runs verification stages in one shell command", () => {
    const command = verificationCommand([
      { name: "typecheck", command: "npm run typecheck" },
      { name: "lint", command: "npm run lint" },
    ])

    expect(command).toContain("if (npm run typecheck); then")
    expect(command).toContain("if (npm run lint); then")
    expect(command).toContain("SYLPH_STAGE_FAILED=lint")
  })

  test("reads stage durations and the failing stage", () => {
    const output = [
      "SYLPH_STAGE_STARTED=typecheck:100",
      "SYLPH_STAGE_PASSED=typecheck:140",
      "SYLPH_STAGE_STARTED=lint:150",
      "SYLPH_STAGE_FAILED=lint:175",
    ].join("\n")

    expect(verificationDurations(output).get("typecheck")).toBe(40)
    expect(verificationFailureStage(output)).toBe("lint")
  })

  test("stops the shared runner at the failing stage", () => {
    const result = Bun.spawnSync({
      cmd: [
        "sh",
        "-c",
        verificationCommand([
          { name: "typecheck", command: "true" },
          { name: "lint", command: "false" },
          { name: "test", command: "true" },
        ]),
      ],
    })
    const output = result.stdout.toString()

    expect(result.exitCode).not.toBe(0)
    expect(verificationFailureStage(output)).toBe("lint")
    expect(output).not.toContain("SYLPH_STAGE_STARTED=test")
  })
})

test("overlaps read-only checks but waits before tests and build", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const directory = await mkdtemp(join(tmpdir(), "sylph-ci-"))
  try {
    const barrier = (own: string, other: string) =>
      `touch '${directory}/${own}'; attempt=0; while [ ! -f '${directory}/${other}' ]; do attempt=$((attempt + 1)); [ "$attempt" -lt 100 ] || exit 7; sleep 0.01; done`
    const command = verificationCommand([
      { name: "typecheck", command: barrier("typecheck", "lint") },
      { name: "lint", command: barrier("lint", "typecheck") },
      {
        name: "test",
        command: `test -f '${directory}/typecheck' && test -f '${directory}/lint' && touch '${directory}/test'`,
      },
      { name: "build", command: `test -f '${directory}/test'` },
    ])
    const result = Bun.spawnSync({ cmd: ["sh", "-c", command] })
    expect(result.exitCode).toBe(0)
    expect(verificationDurations(result.stdout.toString()).size).toBe(4)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("retains both parallel failures and their stderr", () => {
  const result = Bun.spawnSync({
    cmd: [
      "sh",
      "-c",
      verificationCommand([
        { name: "typecheck", command: "echo type-error >&2; exit 2" },
        { name: "lint", command: "echo lint-error >&2; exit 3" },
        { name: "build", command: "true" },
      ]),
    ],
  })
  expect(result.exitCode).not.toBe(0)
  expect(result.stdout.toString()).toContain("SYLPH_STAGE_FAILED=typecheck")
  expect(result.stdout.toString()).toContain("SYLPH_STAGE_FAILED=lint")
  expect(result.stdout.toString()).not.toContain("SYLPH_STAGE_STARTED=build")
  expect(result.stderr.toString()).toContain("type-error")
  expect(result.stderr.toString()).toContain("lint-error")
})

test("supports serial verification for scripts with shared outputs", () => {
  const result = Bun.spawnSync({
    cmd: [
      "sh",
      "-c",
      verificationCommand(
        [
          { name: "typecheck", command: "exit 2" },
          { name: "lint", command: "true" },
        ],
        1
      ),
    ],
  })
  expect(result.exitCode).toBe(2)
  expect(result.stdout.toString()).not.toContain("SYLPH_STAGE_STARTED=lint")
})

test("install finishes before verification and its failure stops every check", () => {
  const success = Bun.spawnSync({
    cmd: [
      "sh",
      "-c",
      verificationCommand([
        {
          name: "install",
          command: 'export SYLPH_INSTALLED=1; touch "$sylph_logs/installed"',
        },
        { name: "typecheck", command: 'test -f "$sylph_logs/installed"' },
        { name: "lint", command: 'test -f "$sylph_logs/installed"' },
      ]),
    ],
  })
  expect(success.exitCode).toBe(0)
  expect(
    verificationDurations(success.stdout.toString()).has("install")
  ).toBeTrue()
  const failure = Bun.spawnSync({
    cmd: [
      "sh",
      "-c",
      verificationCommand([
        { name: "install", command: "exit 9" },
        { name: "typecheck", command: "true" },
      ]),
    ],
  })
  expect(failure.exitCode).toBe(9)
  expect(verificationFailureStage(failure.stdout.toString())).toBe("install")
  expect(failure.stdout.toString()).not.toContain(
    "SYLPH_STAGE_STARTED=typecheck"
  )
})
