import assert from "node:assert/strict"
import { Miniflare } from "miniflare"
import { rolldown } from "rolldown"

export async function verifyWorkflowInputs() {
  const build = await rolldown({
    input: new URL("./workflow-inputs-worker.js", import.meta.url).pathname,
    external: ["cloudflare:workers"],
  })
  let script
  try {
    const { output } = await build.generate({
      format: "esm",
      strictExecutionOrder: true,
    })
    const entry = output.find((item) => item.type === "chunk" && item.isEntry)
    assert(entry?.type === "chunk")
    script = entry.code
  } finally {
    await build.close()
  }
  const worker = new Miniflare({
    compatibilityDate: "2026-03-17",
    compatibilityFlags: ["nodejs_compat"],
    modules: true,
    script,
    workflows: { INPUT: { name: "input", className: "InputWorkflow" } },
  })
  try {
    for (const [path, params] of [
      ["/provision", { workspaceId: "workspace" }],
      ["/message", { workspaceId: "workspace", messageId: "message" }],
    ]) {
      const response = await worker.dispatchFetch(`https://fixture.test${path}`)
      assert.equal(response.status, 200)
      const result = await response.json()
      assert.match(result.id, /^[a-f0-9-]{36}$/)
      assert.deepEqual(result.params, params)
    }
    console.log("Workerd accepted provisioning and message delivery payloads")
  } finally {
    await worker.dispose()
  }
}
