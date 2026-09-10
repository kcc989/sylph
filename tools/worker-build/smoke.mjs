import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Miniflare } from "miniflare"

const modules = async (directory) => {
  const root = resolve(directory)
  const names = (await readdir(root, { recursive: true })).filter((name) =>
    name.endsWith(".js")
  )
  names.sort((left, right) =>
    left === "worker.js"
      ? -1
      : right === "worker.js"
        ? 1
        : left.localeCompare(right)
  )
  return Promise.all(
    names.map(async (name) => ({
      type: "ESModule",
      path: join(root, name),
      contents: await readFile(join(root, name), "utf8"),
    }))
  )
}
const directory = await mkdtemp(join(tmpdir(), "sylph-workers-"))
const options = {
  durableObjectsPersist: directory,
  unsafeInspectDurableObjects: true,
  workers: [
    {
      name: "probe",
      modules: true,
      serviceBindings: { RUNTIME: "runtime" },
      script: `export default { async fetch(request, env) {
        const path = new URL(request.url).pathname;
        if (path === "/runtime-status") return Response.json(await env.WORKSPACES.getByName("boot").snapshot());
        if (path === "/socket") return env.WORKSPACES.getByName("idle").fetch(request);
        return env.RUNTIME.fetch(request);
      } }`,
      compatibilityDate: "2026-03-17",
      durableObjects: {
        WORKSPACES: {
          className: "WorkspaceDO",
          scriptName: "runtime",
          useSQLite: true,
        },
      },
    },
    {
      name: "runtime",
      modulesRoot: resolve("dist/runtime"),
      modules: await modules("dist/runtime"),
      compatibilityDate: "2026-03-17",
      compatibilityFlags: ["nodejs_compat"],
      serviceBindings: {
        FRONTEND: "web",
        BROWSER: () => new Response("Browser disabled", { status: 503 }),
      },
      durableObjects: {
        WORKSPACES: { className: "WorkspaceDO", useSQLite: true },
      },
      outboundService: () =>
        new Response("External access disabled", { status: 503 }),
    },
    {
      name: "web",
      assets: {
        directory: resolve("apps/web/dist/client"),
        binding: "ASSETS",
        routerConfig: { has_user_worker: true },
      },
      modulesRoot: resolve("apps/web/dist/server"),
      modules: await modules("apps/web/dist/server"),
      compatibilityDate: "2026-03-17",
      compatibilityFlags: ["nodejs_compat"],
      bindings: {
        SYLPH_URL: "https://fixture.test",
        SYLPH_SMOKE_SOURCE_COMMIT: "a".repeat(40),
        SYLPH_SMOKE_TEMPLATE_COMMIT: "b".repeat(40),
        SYLPH_SMOKE_STAGE: "smoke-workers",
      },
      durableObjects: {
        WORKSPACES: { className: "WorkspaceDO", scriptName: "runtime" },
      },
      outboundService: () =>
        new Response("External access disabled", { status: 503 }),
    },
  ],
}
let runtime = new Miniflare(options)
try {
  console.log("Checking web forwarding")
  const identity = await runtime.dispatchFetch(
    "https://fixture.test/__sylph/smoke-identity"
  )
  assert.equal(identity.status, 200)
  assert.equal((await identity.json()).sourceCommit, "a".repeat(40))
  const asset = await runtime.dispatchFetch("https://fixture.test/favicon.svg")
  assert.equal(asset.status, 200)
  assert.equal(
    await asset.text(),
    await readFile("apps/web/dist/client/favicon.svg", "utf8")
  )
  console.log("Checking capability denial")
  const denied = await runtime.dispatchFetch(
    "https://fixture.test/api/project-deployment/test",
    { method: "POST", body: "unauthorized" }
  )
  assert.equal(denied.status, 403)
  console.log("Checking cross-worker Workspace access")
  const rejected = await runtime.dispatchFetch("https://fixture.test/socket")
  assert.equal(rejected.status, 426, await rejected.text())
  console.log("Checking lazy initialization storage")
  const state = await runtime.unsafeGetDurableObjectStorage(
    "runtime",
    "WorkspaceDO",
    { name: "idle" }
  )
  console.log("Reading lazy initialization tables")
  const tables = await state.exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' AND name NOT LIKE '__miniflare_%'"
  )
  assert.deepEqual(
    tables,
    [],
    "A rejected socket request must not boot OpenCode or create product tables"
  )
  console.log("Checking socket ping")
  const response = await runtime.dispatchFetch("https://fixture.test/socket", {
    headers: {
      Upgrade: "websocket",
      "x-sylph-user-id": "user",
      "x-sylph-user-name": "Ada",
    },
  })
  assert.equal(response.status, 101)
  const socket = response.webSocket
  assert(socket)
  socket.accept()
  const pong = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("WebSocket ping timed out")),
      5000
    )
    socket.addEventListener(
      "message",
      (event) => {
        clearTimeout(timer)
        resolve(event.data)
      },
      { once: true }
    )
  })
  socket.send("ping")
  assert.equal(await pong, "pong")
  socket.close(1000)
  assert.deepEqual(
    await state.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' AND name NOT LIKE '__miniflare_%'"
    ),
    []
  )
  console.log("Checking first-use OpenCode startup")
  const status = await runtime.dispatchFetch(
    "https://fixture.test/runtime-status"
  )
  assert.equal(status.status, 200, await status.clone().text())
  assert.equal((await status.json()).opencode.healthy, true)
  await state.exec("CREATE TABLE lifecycle_probe (value TEXT NOT NULL)")
  await state.exec("INSERT INTO lifecycle_probe VALUES (?)", "durable")
  await runtime.dispose()
  runtime = new Miniflare(options)
  const restored = await runtime.unsafeGetDurableObjectStorage(
    "runtime",
    "WorkspaceDO",
    { name: "idle" }
  )
  assert.deepEqual(await restored.exec("SELECT value FROM lifecycle_probe"), [
    { value: "durable" },
  ])
  const afterRestart = await runtime.dispatchFetch(
    "https://fixture.test/runtime-status"
  )
  assert.equal(afterRestart.status, 200, await afterRestart.clone().text())
  assert.equal((await afterRestart.json()).opencode.healthy, true)
  console.log(
    "Built Workers passed service routing, static assets, denied capability, cross-worker DO access, lazy startup, ping, and persisted restart checks"
  )
} finally {
  await runtime.dispose()
  await rm(directory, { recursive: true, force: true })
}
