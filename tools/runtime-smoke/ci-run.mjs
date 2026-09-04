import assert from "node:assert/strict"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Miniflare } from "miniflare"
import { buildWorker } from "./build.mjs"

const directory = await realpath(
  await mkdtemp(join(tmpdir(), "sylph-ci-stream-"))
)
let runtime
try {
  await buildWorker(
    directory,
    new URL("./ci-worker.js", import.meta.url).pathname,
    [
      {
        name: "fixture-runner",
        resolveId(source, importer) {
          if (
            source === "../ci/capabilities" &&
            importer?.endsWith("/pipeline/ci-workflow.ts")
          )
            return new URL("./ci-runner-fixture.js", import.meta.url).pathname
        },
      },
    ]
  )
  const options = {
    modules: true,
    modulesRoot: directory,
    scriptPath: join(directory, "worker.js"),
    compatibilityDate: "2026-07-01",
    compatibilityFlags: ["nodejs_compat"],
    workflows: { PROBE: { name: "ci-stream-probe", className: "Probe" } },
    workflowsPersist: join(directory, "workflows"),
    kvNamespaces: ["RECORDS"],
    kvPersist: join(directory, "kv"),
    outboundService: () =>
      new Response("External requests are disabled", { status: 503 }),
  }
  runtime = new Miniflare(options)
  const read = async (path) => {
    const response = await runtime.dispatchFetch(`http://probe.test${path}`)
    assert.equal(response.status, 200)
    return response.json()
  }
  const waitFor = async (id, target) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const result = await read(`/status?id=${id}`)
      assert.notEqual(result.status, "errored", JSON.stringify(result.error))
      if (
        result.status === target ||
        (target === "waiting" && result.waiting === "yes")
      )
        return result
      if (attempt === 199) console.log(JSON.stringify(result))
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(`Workflow did not reach ${target}`)
  }
  const { id } = await read("/start")
  await waitFor(id, "waiting")
  await runtime.dispose()
  runtime = new Miniflare(options)
  await read(`/resume?id=${id}`)
  const completed = await waitFor(id, "complete")
  assert.equal(completed.result.invocations, 2)
  assert.equal(
    completed.result.stdoutBytes,
    Buffer.byteLength(
      `SYLPH_DEPENDENCY_RESULT=${Buffer.alloc(5 * 1024 * 1024, "x").toString("base64")}\n`
    )
  )
  assert.equal(completed.result.stderrBytes, 440000)
  console.log(
    JSON.stringify({
      status: "passed",
      replayedWithoutRerun: true,
      ...completed.result,
    })
  )
} finally {
  await runtime?.dispose()
  await rm(directory, { recursive: true, force: true })
}
