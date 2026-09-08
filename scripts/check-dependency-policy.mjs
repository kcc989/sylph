import { existsSync, readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const root = fileURLToPath(new URL("../", import.meta.url))
const manifests = [join(root, "package.json")]
for (const directory of ["apps", "packages"])
  for (const entry of readdirSync(join(root, directory), {
    withFileTypes: true,
  })) {
    const manifest = join(root, directory, entry.name, "package.json")
    if (entry.isDirectory() && existsSync(manifest)) manifests.push(manifest)
  }

if (existsSync(join(root, "patches")))
  throw new Error(
    "Third-party dependency patches are prohibited: remove patches/"
  )

for (const manifest of manifests) {
  const value = JSON.parse(readFileSync(manifest, "utf8"))
  if (
    Object.hasOwn(value, "patchedDependencies") ||
    Object.hasOwn(value.pnpm ?? {}, "patchedDependencies")
  )
    throw new Error(
      `Third-party dependency patches are prohibited: ${manifest}`
    )
}
