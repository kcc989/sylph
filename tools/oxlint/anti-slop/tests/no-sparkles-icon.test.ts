import { describe, expect, test } from "bun:test"

const oxlint = "node_modules/.bin/oxlint"
const config = "tools/oxlint/anti-slop/tests/no-sparkles-icon.config.ts"
const fixture = (name: string) =>
  `tools/oxlint/anti-slop/tests/fixtures/${name}.tsx`

const lint = (name: string) =>
  Bun.spawnSync([oxlint, "--config", config, fixture(name)], {
    stdout: "pipe",
    stderr: "pipe",
  })

const output = (result: ReturnType<typeof lint>) =>
  `${result.stdout.toString()}${result.stderr.toString()}`

describe("no-sparkles-icon", () => {
  test("accepts specific Lucide icons", () => {
    expect(lint("no-sparkles-icon-valid").exitCode).toBe(0)
  })

  test("rejects aliased sparkle imports", () => {
    const result = lint("no-sparkles-icon-import")

    expect(result.exitCode).toBe(1)
    expect(output(result)).toContain(
      "Replace the sparkle icon with an icon that names the action"
    )
  })

  test("rejects sparkle icons from namespace imports", () => {
    const result = lint("no-sparkles-icon-namespace")

    expect(result.exitCode).toBe(1)
    expect(output(result)).toContain(
      "Replace the sparkle icon with an icon that names the action"
    )
  })

  test("rejects deep sparkle imports", () => {
    const result = lint("no-sparkles-icon-deep-import")

    expect(result.exitCode).toBe(1)
    expect(output(result)).toContain(
      "Replace the sparkle icon with an icon that names the action"
    )
  })
})
