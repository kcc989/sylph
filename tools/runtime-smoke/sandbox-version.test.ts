import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

test("CI resolves the Sandbox SDK version used by the container image", async () => {
  const ciRequire = createRequire(import.meta.resolve("@cloudflare/ci"))
  const sdk = JSON.parse(
    await readFile(
      join(
        dirname(ciRequire.resolve("@cloudflare/sandbox")),
        "..",
        "package.json"
      ),
      "utf8"
    )
  )
  const root = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8")
  )
  const infrastructure = await readFile(
    new URL("../../alchemy.run.ts", import.meta.url),
    "utf8"
  )
  const imageVersion = infrastructure.match(
    /docker\.io\/cloudflare\/sandbox:([^@"]+)@sha256:/
  )?.[1]
  expect(imageVersion).toBeDefined()
  expect(sdk.version).toBe(imageVersion)
  expect(root.dependencies["@cloudflare/sandbox"]).toBe(imageVersion)
})
