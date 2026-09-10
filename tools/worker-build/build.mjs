import { mkdir, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { rolldown } from "rolldown"
import cloudflare from "@alchemy.run/cloudflare-runtime/rolldown"

const directory = resolve("dist/runtime")
await rm(directory, { recursive: true, force: true })
await mkdir(directory, { recursive: true })
const build = await rolldown({
  input: "apps/web/src/runtime-worker.ts",
  plugins: cloudflare({
    compatibilityDate: "2026-03-17",
    compatibilityFlags: ["nodejs_compat"],
  }),
  external: ["lightningcss", "fsevents"],
  transform: { define: { "globalThis.__ALCHEMY_RUNTIME__": "true" } },
  checks: { unresolvedImport: false, ineffectiveDynamicImport: false },
})
try {
  const result = await build.write({
    format: "esm",
    sourcemap: "hidden",
    minify: true,
    keepNames: true,
    strictExecutionOrder: true,
    dir: directory,
    entryFileNames: "worker.js",
  })
  const modules = result.output.filter((item) => item.type === "chunk")
  await writeFile(
    "dist/runtime-inputs.json",
    JSON.stringify(
      [...new Set(modules.flatMap((item) => Object.keys(item.modules)))].sort(),
      null,
      2
    )
  )
} finally {
  await build.close()
}
