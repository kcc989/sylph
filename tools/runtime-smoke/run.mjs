import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Miniflare } from "miniflare"
import { buildWorker } from "./build.mjs"

const deadline = async (promise, label) => {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), 15000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const directory = await realpath(
  await mkdtemp(join(tmpdir(), "sylph-workerd-"))
)
const first = deferred()
const release = deferred()
const recovered = deferred()
const requests = []
let miniflare

try {
  await buildWorker(directory)
  const names = (await readdir(directory)).filter((name) =>
    name.endsWith(".js")
  )
  names.sort((a, b) =>
    a === "worker.js" ? -1 : b === "worker.js" ? 1 : a.localeCompare(b)
  )
  miniflare = new Miniflare({
    compatibilityDate: "2026-03-17",
    compatibilityFlags: ["nodejs_compat"],
    modulesRoot: directory,
    modules: await Promise.all(
      names.map(async (name) => ({
        type: "ESModule",
        path: join(directory, name),
        contents: await readFile(join(directory, name), "utf8"),
      }))
    ),
    durableObjects: { PROBE: { className: "Probe", useSQLite: true } },
    outboundService: async (request) => {
      if (new URL(request.url).hostname !== "fixture.test")
        return new Response("External requests are disabled", { status: 503 })
      const body = await request.json()
      if (body.tools?.length) {
        requests.push(body.tools.map((tool) => tool.function.name))
        if (requests.length === 1) {
          first.resolve()
          await release.promise
        } else recovered.resolve()
      }
      const chunks = [
        {
          id: "fixture",
          object: "chat.completion.chunk",
          created: 1,
          model: "fixture",
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "Fixture complete." },
              finish_reason: null,
            },
          ],
        },
        {
          id: "fixture",
          object: "chat.completion.chunk",
          created: 1,
          model: "fixture",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
        },
      ]
      return new Response(
        chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
          "data: [DONE]\n\n",
        { headers: { "Content-Type": "text/event-stream" } }
      )
    },
  })
  const read = async (route) => {
    const response = await deadline(
      miniflare.dispatchFetch(`http://probe.test/${route}`),
      route
    )
    assert.equal(
      response.status,
      200,
      `${route} failed: ${await response.clone().text()}`
    )
    return response.json()
  }
  const started = performance.now()
  const health = await read("health")
  assert.equal(health.health.healthy, true)
  const session = await read("start")
  await deadline(first.promise, "Initial model request")
  assert.ok(requests[0].includes("probe_recovery_tool"))
  const reset = await deadline(
    miniflare.dispatchFetch("http://probe.test/abort"),
    "Reset"
  )
  assert.equal(reset.status, 500)
  assert.equal((await read("health")).health.healthy, true)
  release.resolve()
  await deadline(recovered.promise, "Recovered model request")
  assert.ok(requests[1].includes("probe_recovery_tool"))
  const result = await read("complete")
  assert.equal(result.sessionID, session.sessionID)
  assert.equal(result.outcome, "succeeded")
  assert.ok(result.messages.data.some((message) => message.type === "user"))
  assert.ok(
    result.messages.data.some(
      (message) =>
        message.type === "assistant" &&
        message.time.completed !== undefined &&
        message.content.some(
          (part) =>
            part.type === "text" && part.text.includes("Fixture complete.")
        )
    )
  )
  const stats = await read("stats")
  assert.ok(stats.storageBytes > 0)
  console.log(
    JSON.stringify(
      {
        status: "passed",
        recoveredSession: true,
        initialPluginsPresent: true,
        recoveredPluginsPresent: true,
        completedMessages: result.messages.data.length,
        bootMs: health.bootMs,
        storageBytes: stats.storageBytes,
        elapsedMs: Math.round(performance.now() - started),
      },
      null,
      2
    )
  )
} finally {
  release.resolve()
  await miniflare?.dispose()
  await rm(directory, { recursive: true, force: true })
}
