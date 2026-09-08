const build = await Bun.build({
  entrypoints: [new URL("./object-worker.ts", import.meta.url).pathname],
  target: "browser",
  external: ["cloudflare:workers"],
})

if (!build.success || !build.outputs[0])
  throw new Error("Object fixture build failed")

export const objectWorkerScript = await build.outputs[0].text()
