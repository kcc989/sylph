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
const cacheRequests = []
let miniflare
let nativeMode = false
let nativeCallIndex = 0
const nativeCalls = [
  { name: "glob", arguments: { pattern: "*.txt", path: "/workspace" } },
  { name: "grep", arguments: { pattern: "before", path: "/workspace" } },
  { name: "read", arguments: { path: "/workspace/native.txt" } },
  {
    name: "write",
    arguments: { path: "/workspace/native.txt", content: "written\n" },
  },
  {
    name: "edit",
    arguments: {
      path: "/workspace/native.txt",
      oldString: "written",
      newString: "edited",
    },
  },
  { name: "read", arguments: { path: "/workspace/native.txt" } },
]

const patchCalls = [
  {
    name: "patch",
    arguments: {
      patchText:
        "*** Begin Patch\n*** Add File: temporary.txt\n+temporary\n*** End Patch",
    },
  },
  {
    name: "patch",
    arguments: {
      patchText:
        "*** Begin Patch\n*** Delete File: temporary.txt\n*** End Patch",
    },
  },
]
let patchMode = false

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
      if (body.model === "anthropic/claude-sonnet-4.6")
        cacheRequests.push({
          body,
          session: request.headers.get("x-session-id"),
        })
      if (body.tools?.length) {
        requests.push(body.tools.map((tool) => tool.function.name))
        if (!nativeMode && requests.length === 1) {
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
          usage: {
            prompt_tokens: 10,
            completion_tokens: 3,
            total_tokens: 13,
            prompt_tokens_details: { cached_tokens: 6, cache_write_tokens: 2 },
          },
        },
      ]
      if (
        nativeMode &&
        JSON.stringify(body.messages).includes(
          "Exercise native file tools on native.txt."
        ) &&
        nativeCallIndex < (patchMode ? patchCalls : nativeCalls).length
      ) {
        const call = (patchMode ? patchCalls : nativeCalls)[nativeCallIndex]
        assert.ok(
          body.tools.some((tool) => tool.function.name === call.name),
          `Native ${call.name} is missing: ${body.tools.map((tool) => tool.function.name).join(", ")}`
        )
        nativeCallIndex++
        chunks[0].choices[0].delta = {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: `native-${nativeCallIndex}`,
              type: "function",
              function: {
                name: call.name,
                arguments: JSON.stringify(call.arguments),
              },
            },
          ],
        }
        chunks[1].choices[0].finish_reason = "tool_calls"
      }
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
  nativeMode = true
  await read("native-start")
  const nativeResult = await read("complete")
  assert.equal(nativeResult.outcome, "succeeded")
  assert.equal(nativeCallIndex, nativeCalls.length)
  const nativeTools = nativeResult.messages.data.flatMap((message) =>
    message.type === "assistant"
      ? message.content.filter((part) => part.type === "tool")
      : []
  )
  assert.equal(
    nativeTools.length,
    nativeCalls.length,
    JSON.stringify(nativeResult.messages)
  )
  for (const tool of nativeTools) {
    assert.equal(tool.state.status, "completed", JSON.stringify(tool))
  }
  assert.deepEqual(await read("native-state"), {
    files: ["native.txt"],
    content: "edited\n",
  })
  patchMode = true
  nativeCallIndex = 0
  await read("patch-start")
  const patchResult = await read("complete")
  const patchTools = patchResult.messages.data.flatMap((message) =>
    message.type === "assistant"
      ? message.content.filter((part) => part.type === "tool")
      : []
  )
  assert.equal(
    patchTools.length,
    patchCalls.length,
    JSON.stringify(patchResult.messages)
  )
  for (const tool of patchTools)
    assert.equal(tool.state.status, "completed", JSON.stringify(tool))
  assert.deepEqual((await read("native-state")).files, ["native.txt"])
  const cacheSession = await read("cache-start")
  assert.equal((await read("complete")).outcome, "succeeded")
  const requestsBeforeNotice = cacheRequests.length
  assert.deepEqual(await read("check-notice"), { active: false })
  assert.equal(cacheRequests.length, requestsBeforeNotice)
  const cacheUsage = await read("cache-next")
  const cacheTurns = cacheRequests.filter((entry) => entry.body.tools?.length)
  assert.equal(cacheTurns.length, 2)
  assert.ok(
    JSON.stringify(cacheTurns[1].body.messages).includes(
      "Fixture Check passed. Do not repeat Checks."
    )
  )
  for (const entry of cacheRequests) {
    assert.deepEqual(entry.body.cache_control, { type: "ephemeral" })
    assert.equal(entry.session, cacheSession.sessionID)
    assert.equal(entry.body.prompt_cache_key, cacheSession.sessionID)
  }
  assert.deepEqual(cacheTurns[0].body.tools, cacheTurns[1].body.tools)
  assert.deepEqual(
    cacheTurns[0].body.messages,
    cacheTurns[1].body.messages.slice(0, cacheTurns[0].body.messages.length)
  )
  assert.ok(cacheUsage.tokens.cache.read >= 12)
  assert.ok(cacheUsage.tokens.cache.write >= 4)
  const beforeBudgetProbe = cacheRequests.length
  await read("budget-start")
  const budgetResult = await read("complete")
  assert.equal(budgetResult.outcome, "failed")
  assert.equal(cacheRequests.length, beforeBudgetProbe)
  const compacted = await read("compact")
  assert.ok(
    compacted.data.some(
      (message) =>
        message.type === "compaction" && message.status === "completed"
    )
  )
  assert.equal(cacheRequests.length, beforeBudgetProbe + 1)
  assert.equal(
    (await miniflare.dispatchFetch("http://probe.test/abort")).status,
    500
  )
  await read("health")
  assert.equal((await read("native-state")).content, "edited\n")
  console.log(
    JSON.stringify(
      {
        status: "passed",
        recoveredSession: true,
        initialPluginsPresent: true,
        recoveredPluginsPresent: true,
        nativeFileTools: true,
        nativeSearchTools: true,
        nativeFilesSurviveRestart: true,
        nativeCacheConfiguration: true,
        nativeCacheUsage: true,
        checkNoticeDoesNotResume: true,
        oversizedRequestBlockedBeforeProvider: true,
        boundedNativeCompactionRecovery: true,
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
