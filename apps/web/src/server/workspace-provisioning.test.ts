import { expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

test("provisioning Workflow initializes and restarts with durable-step retries", () => {
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      "test",
      fileURLToPath(
        new URL("./workspace-provisioning.fixture.mjs", import.meta.url)
      ),
    ],
    stdout: "pipe",
    stderr: "pipe",
  })
  expect(new TextDecoder().decode(result.stderr)).toContain("9 pass")
  expect(result.exitCode).toBe(0)
})
