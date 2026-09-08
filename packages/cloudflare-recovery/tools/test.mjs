import { readdirSync } from "node:fs"
import { spawnSync } from "node:child_process"

const files = readdirSync(new URL("../test/", import.meta.url))
  .filter((file) => file.endsWith(".test.ts"))
  .sort()

if (files.length === 0) throw new Error("No recovery test files found")

for (const file of files) {
  const result = spawnSync(process.execPath, ["test", `./test/${file}`], {
    cwd: new URL("../", import.meta.url),
    stdio: "inherit",
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
