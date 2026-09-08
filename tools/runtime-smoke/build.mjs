import { rolldown } from "rolldown"
import cloudflare from "@alchemy.run/cloudflare-runtime/rolldown"
import { esmExternalRequirePlugin } from "rolldown/plugins"

export async function buildWorker(directory) {
  const plugins = cloudflare({
    compatibilityDate: "2026-03-17",
    compatibilityFlags: ["nodejs_compat"],
  }).map((plugin) =>
    plugin?.name === "builtin:esm-external-require" && "_options" in plugin
      ? esmExternalRequirePlugin(plugin._options)
      : plugin
  )
  const build = await rolldown({
    input: new URL("./worker.js", import.meta.url).pathname,
    plugins,
    external: ["lightningcss", "fsevents"],
    checks: { unresolvedImport: false, ineffectiveDynamicImport: false },
  })
  await build.write({
    format: "esm",
    sourcemap: "hidden",
    minify: true,
    keepNames: true,
    strictExecutionOrder: true,
    dir: directory,
    entryFileNames: "worker.js",
  })
  await build.close()
}
