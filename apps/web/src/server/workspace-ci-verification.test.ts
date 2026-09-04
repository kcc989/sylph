import { describe, expect, test } from "bun:test"

import {
  verificationCommand,
  verificationDurations,
  verificationFailureStage,
} from "./workspace-ci-verification"

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
