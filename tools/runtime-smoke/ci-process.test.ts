import { expect, test } from "bun:test"
import { subshellCommand } from "../../node_modules/@cloudflare/ci/src/ci/runners/runner"

test("executes heredocs and trailing shell comments without consuming the wrapper", async () => {
  const command =
    "cat <<'DONE'\nmultiline output\nDONE\nprintf 'error output' >&2\n# trailing shell comment"
  const process = Bun.spawn(["bash", "-c", subshellCommand(command)], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  expect(exitCode).toBe(0)
  expect(stdout).toBe("multiline output\n")
  expect(stderr).toBe("error output")
})
