import { readdirSync } from "node:fs"
import { spawn } from "node:child_process"

const files = readdirSync(new URL("../test/", import.meta.url))
  .filter((file) => file.endsWith(".test.ts"))
  .sort()

if (files.length === 0) throw new Error("No recovery test files found")

for (const file of files) {
  const child = spawn(
    process.execPath,
    ["test", "--timeout", "30000", `./test/${file}`],
    {
      cwd: new URL("../", import.meta.url),
      stdio: "inherit",
      timeout: 120_000,
      killSignal: "SIGKILL",
    }
  )
  const status = await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("exit", resolve)
  })
  if (status !== 0) process.exit(status ?? 1)
}
