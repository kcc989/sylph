import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { redirectCommand } from "../../node_modules/@cloudflare/ci/src/shared/shell"

test("CI command preserves heredocs, output paths, and failure status", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sylph-ci-shell-"))
  const stdout = join(directory, "stdout ' log")
  const stderr = join(directory, "stderr log")
  try {
    const command = "cat <<'END'\nlockfile result\nEND"
    const success = Bun.spawn([
      "sh",
      "-c",
      redirectCommand(command, stdout, stderr),
    ])
    expect(await success.exited).toBe(0)
    expect(await readFile(stdout, "utf8")).toBe("lockfile result\n")
    const failure = Bun.spawn([
      "sh",
      "-c",
      redirectCommand("printf diagnostic >&2\nexit 7", stdout, stderr),
    ])
    expect(await failure.exited).toBe(7)
    expect(await readFile(stderr, "utf8")).toBe("diagnostic")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
