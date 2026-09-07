import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { tmpdir } from "node:os"
import { setTimeout } from "node:timers/promises"
import {
  configurationPath,
  smokeConfiguration,
  serializeEnvironment,
} from "../release-smoke/config.mjs"

const root = resolve(import.meta.dirname, "../..")
const stage = `smoke-browser-${Date.now().toString(36)}`
const directory = resolve(root, ".alchemy/browser-smoke-runs", stage)
await mkdir(directory, { recursive: true, mode: 0o700 })
const token = crypto.randomUUID()
const configuration = smokeConfiguration(
  await readFile(configurationPath(process.env), "utf8"),
  configurationPath(process.env),
  "magic"
)
const commit = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).stdout.trim()
const sourceDiff = spawnSync("git", ["diff", "HEAD"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
}).stdout
const paths = spawnSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8" }
)
  .stdout.split("\0")
  .filter((path) => /\.(ts|tsx|js|mjs|json|lock)$/.test(path))
  .sort()
const sourceManifest = await Promise.all(
  paths.map(async (path) => ({
    path,
    sha256: createHash("sha256")
      .update(await readFile(resolve(root, path)))
      .digest("hex"),
  }))
)
const sourceHash = createHash("sha256")
  .update(JSON.stringify(sourceManifest))
  .digest("hex")
await writeFile(
  resolve(directory, "source-manifest.json"),
  JSON.stringify(sourceManifest, null, 2)
)
const environment = {
  CLOUDFLARE_ACCOUNT_ID: configuration.CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN: configuration.CLOUDFLARE_API_TOKEN,
  R2_ACCESS_KEY_ID: configuration.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: configuration.R2_SECRET_ACCESS_KEY,
  SYLPH_BROWSER_SMOKE_TOKEN: token,
  SYLPH_BROWSER_SMOKE_COMMIT: commit,
  SYLPH_BROWSER_SMOKE_SOURCE: sourceHash,
}
const deploymentDirectory = await mkdtemp(
  resolve(tmpdir(), "sylph-browser-deploy-")
)
const environmentPath = resolve(deploymentDirectory, "deploy.env")
await writeFile(environmentPath, serializeEnvironment(environment), {
  mode: 0o600,
})
await writeFile(resolve(directory, "source.diff"), sourceDiff)
const record = {
  stage,
  commit,
  sourceHash,
  dirty:
    spawnSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
    }).stdout.trim().length > 0,
  auth: "disposable fixture password",
  status: "deploying",
  results: [],
}
const recordPath = resolve(directory, "run.json")
const save = () => writeFile(recordPath, JSON.stringify(record, null, 2))
await save()
console.log(`Deploying Browser Run smoke: ${stage}\nRun record: ${recordPath}`)
const deployed = spawnSync(
  "bun",
  [
    "alchemy",
    "deploy",
    "tools/browser-smoke/alchemy.run.ts",
    "--env-file",
    environmentPath,
    "--stage",
    stage,
    "--yes",
  ],
  {
    cwd: root,
    env: { ...process.env, ...environment },
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  }
)
const output = `${deployed.stdout ?? ""}${deployed.stderr ?? ""}`
await writeFile(resolve(directory, "deploy.log"), output, { mode: 0o600 })
if (deployed.status !== 0) {
  record.status = "deploy_failed"
  await save()
  throw new Error(`Deployment failed. Inspect ${directory}/deploy.log`)
}
const match = [
  ...output.matchAll(/browserSmokeUrl[^h]*(https:[^'"\s,}]+)/g),
].at(-1)
assert.ok(match, "Alchemy did not return browserSmokeUrl")
const baseURL = new URL(match[1]).origin
record.baseURL = baseURL
record.status = "testing"
await save()
console.log(`Browser Run fixture: ${baseURL}`)
let ready = false
let oauthOrigin
for (let attempt = 0; attempt < 30; attempt++) {
  const response = await fetch(`${baseURL}/probe/ready`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (
    response.ok &&
    response.headers.get("content-type")?.includes("application/json")
  ) {
    const version = await response.json()
    if (version.commit === commit && version.sourceHash === sourceHash) {
      oauthOrigin = version.oauthOrigin
      ready = true
      break
    }
  }
  await setTimeout(2_000)
}
assert.ok(ready, "The deployed fixture did not become ready")
let sessionId
let screenshotId
const step = async (label, action, expected = "observed", extra = {}) => {
  const response = await fetch(`${baseURL}/probe/browser`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action,
      sessionId,
      requestId: crypto.randomUUID(),
      ...extra,
    }),
    signal: AbortSignal.timeout(120_000),
  })
  const body = await response.text()
  if (!response.headers.get("content-type")?.includes("application/json")) {
    await writeFile(
      resolve(directory, "failed-response.txt"),
      body.replaceAll(token, "[redacted]")
    )
    throw new Error(
      `${label}: unexpected HTTP ${response.status}; see failed-response.txt`
    )
  }
  const result = JSON.parse(body)
  record.results.push({ label, httpStatus: response.status, result })
  await save()
  assert.equal(response.status, 200, `${label}: ${JSON.stringify(result)}`)
  assert.equal(result.outcome, expected, `${label}: ${result.detail}`)
  if (result.session) {
    assert.equal(result.session.commit, commit)
    if (sessionId && action.type !== "start")
      assert.equal(result.session.id, sessionId)
    sessionId = result.session.id
  }
  screenshotId =
    result.evidence.find((item) => item.kind === "screenshot")?.id ??
    screenshotId
  console.log(`Passed: ${label}`)
  return result
}
const check = (label, assertion) =>
  step(label, { type: "assert", assertion }, "passed")
const reject = async (label, input, message) => {
  const response = await fetch(`${baseURL}/probe/browser`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sessionId,
      requestId: crypto.randomUUID(),
      ...input,
    }),
    signal: AbortSignal.timeout(60_000),
  })
  const result = await response.json()
  record.results.push({ label, httpStatus: response.status, result })
  await save()
  assert.equal(response.status, 422, label)
  assert.match(result.error, message)
  console.log(`Passed: ${label}`)
}
const probe = async (path, input) => {
  const response = await fetch(`${baseURL}/probe/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(input ?? {}),
    signal: AbortSignal.timeout(120_000),
  })
  const result = await response.json()
  assert.equal(response.status, 200, JSON.stringify(result))
  return result
}
const expectBlocked = async (label, expected) => {
  const result = await probe("proof")
  assert.equal(
    result.blockers.length > 0,
    expected,
    `${label}: ${result.blockers.join(" ")}`
  )
  record.results.push({ label, proof: result })
  await save()
  console.log(`Passed: ${label}`)
  return result.proof
}
const policy = {
  requirements: [
    {
      id: "crud",
      title: "Create, reload, edit, complete, and delete",
      viewports: ["desktop"],
      assertions: [
        { type: "text", selector: "#signed-in", value: "Signed in" },
        {
          type: "text",
          selector: ".title",
          value: "Browser Run persisted this",
        },
        { type: "count", selector: ".todo", value: 1 },
        { type: "text", selector: ".title", value: "Edited in Browser Run" },
        { type: "checked", selector: ".completed", value: true },
        { type: "count", selector: ".todo", value: 0 },
      ],
    },
    {
      id: "responsive",
      title: "Authenticated responsive view",
      viewports: ["desktop", "mobile"],
      assertions: [
        { type: "text", selector: "#signed-in", value: "Signed in" },
      ],
    },
  ],
  allowedOrigins: [oauthOrigin],
  reason: "Require durable CRUD and both authenticated viewport sizes",
}
try {
  await expectBlocked("No policy blocks acceptance", true)
  await step("Start origin guard probe", { type: "start" })
  await reject(
    "Block native popup before its first external request",
    { action: { type: "click", selector: "#external-popup" } },
    /Preview|configured/
  )
  const visits = await fetch(`${oauthOrigin}/probe/count`, {
    headers: { authorization: `Bearer ${token}` },
  }).then((response) => response.json())
  assert.equal(
    visits.count,
    0,
    "A blocked popup reached its unconfigured origin"
  )
  record.blockedPopupRequests = visits.count
  await probe("policy", policy)
  sessionId = undefined
  await step("Start exact Checkpoint", { type: "start" })
  await step("Begin required CRUD journey", {
    type: "journey_begin",
    requirementId: "crud",
  })
  await check("Rendered source identity", {
    type: "count",
    selector: `[data-sylph-browser-source="${sourceHash}"]`,
    value: 1,
  })
  await step("Fill fixture password", {
    type: "fill",
    selector: "#password",
    value: token,
  })
  await step("Sign in with keyboard", {
    type: "press",
    selector: "#password",
    key: "Enter",
  })
  await step("Wait for sign-in", {
    type: "wait",
    selector: "#signed-in",
    state: "visible",
  })
  await check("Authenticated across reconnects", {
    type: "text",
    selector: "#signed-in",
    value: "Signed in",
  })
  await step("Select saved preference", {
    type: "select",
    selector: "#view",
    values: ["active"],
  })
  await step("Fill new todo", {
    type: "fill",
    selector: "#title",
    value: "Browser Run persisted this",
  })
  await step(
    "Create todo",
    { type: "click", selector: "#create" },
    "observed",
    { requestId: "create-once" }
  )
  await step(
    "Duplicate create does not replay",
    { type: "click", selector: "#create" },
    "observed",
    { requestId: "create-once" }
  )
  await step("Wait for created todo", {
    type: "wait",
    selector: ".todo",
    state: "visible",
  })
  await check("Created todo text", {
    type: "text",
    selector: ".title",
    value: "Browser Run persisted this",
  })
  await step("Reload authenticated page", { type: "reload" })
  await check("Cookie survives reload", {
    type: "text",
    selector: "#signed-in",
    value: "Signed in",
  })
  await check("Local storage survives reload", {
    type: "value",
    selector: "#view",
    value: "active",
  })
  await check("D1 todo survives reload", {
    type: "count",
    selector: ".todo",
    value: 1,
  })
  await step("Fill edited title", {
    type: "fill",
    selector: "#edit-title",
    value: "Edited in Browser Run",
  })
  await step("Save edit", { type: "click", selector: "#edit" })
  await step("Observe saved edit", {
    type: "wait",
    selector: ".title",
    state: "visible",
  })
  await check("Edited title", {
    type: "text",
    selector: ".title",
    value: "Edited in Browser Run",
  })
  await step("Complete todo", { type: "click", selector: "#complete" })
  await step("Observe completion", {
    type: "wait",
    selector: ".completed:checked",
    state: "visible",
  })
  await check("Completed checkbox", {
    type: "checked",
    selector: ".completed",
    value: true,
  })
  const rows = await fetch(`${baseURL}/probe/rows`, {
    headers: { authorization: `Bearer ${token}` },
  }).then((response) => response.json())
  assert.deepEqual(rows.results, [
    { title: "Edited in Browser Run", completed: 1 },
  ])
  record.d1 = rows
  await step("Scroll page", { type: "scroll", x: 0, y: 500 })
  const screenshot = await fetch(`${baseURL}/probe/evidence/${screenshotId}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  assert.equal(screenshot.status, 200)
  await writeFile(
    resolve(directory, "journey.png"),
    Buffer.from(await screenshot.arrayBuffer())
  )
  await step("Delete todo", { type: "click", selector: "#delete" })
  await step("Wait for deletion", {
    type: "wait",
    selector: ".todo",
    state: "hidden",
  })
  await step("Reload after deletion", { type: "reload" })
  await check("Deletion persisted", {
    type: "count",
    selector: ".todo",
    value: 0,
  })
  await step("Complete CRUD proof", { type: "journey_finish" }, "passed")
  await expectBlocked("Missing responsive journey blocks acceptance", true)
  await step("Begin responsive failure attempt", {
    type: "journey_begin",
    requirementId: "responsive",
  })
  await step(
    "Failed assertion stays failed",
    {
      type: "assert",
      assertion: { type: "count", selector: ".todo", value: 2 },
    },
    "failed"
  )
  await expectBlocked("Failed assertion blocks acceptance", true)
  await step("Begin responsive retry", {
    type: "journey_begin",
    requirementId: "responsive",
  })
  for (const viewport of ["desktop", "mobile"]) {
    await step(`Set ${viewport} viewport`, { type: "viewport", viewport })
    await check(`Verify authenticated ${viewport} view`, {
      type: "text",
      selector: "#signed-in",
      value: "Signed in",
    })
  }
  await step("Complete responsive retry", { type: "journey_finish" }, "passed")
  const proved = await expectBlocked(
    "Exact journey proof permits browser acceptance",
    false
  )
  await probe("context", { ...proved.binding, attempt: 2 })
  await expectBlocked("Changed Check attempt blocks old proof", true)
  await probe("context", proved.binding)
  const human = async (label, action) => {
    const result = await probe("human", {
      action,
      sessionId,
      requestId: crypto.randomUUID(),
    })
    assert.notEqual(result.outcome, "failed", label)
    record.results.push({ label, result })
    await save()
    return result
  }
  await human("Human takeover", { type: "take_control" })
  await reject(
    "Agent cannot act during human control",
    { action: { type: "reload" } },
    /User controls/
  )
  await human("Human observes same authenticated session", {
    type: "assert",
    assertion: { type: "text", selector: "#signed-in", value: "Signed in" },
  })
  await human("Human releases control", { type: "release_control" })
  const popup = await step("Open configured external popup", {
    type: "click",
    selector: "#oauth-popup",
  })
  const externalPage = popup.pages.find((page) =>
    page.url.startsWith(oauthOrigin)
  )
  assert.ok(externalPage, "Configured popup was not retained")
  const applicationPage = popup.pages.find((page) =>
    page.url.startsWith(baseURL)
  )
  await step("Select external page", {
    type: "switch_page",
    pageId: externalPage.id,
  })
  await step("Fill external fixture password", {
    type: "fill",
    selector: "#external-password",
    value: token,
  })
  await step("Submit external sign-in", {
    type: "click",
    selector: "#external-sign-in",
  })
  await check("Authenticated external page survives reconnect", {
    type: "text",
    selector: "#external-signed-in",
    value: "External sign-in retained",
  })
  await step("Return to application page", {
    type: "switch_page",
    pageId: applicationPage.id,
  })
  await check("Application cookies remain in shared context", {
    type: "text",
    selector: "#signed-in",
    value: "Signed in",
  })
  await step("Begin interrupted journey", {
    type: "journey_begin",
    requirementId: "responsive",
  })
  await step("Close unfinished journey", { type: "close" }, "closed")
  await expectBlocked("Interrupted journey blocks acceptance", true)
  sessionId = undefined
  await step("Start for final navigation checks", { type: "start" })
  await step("Sign in again", {
    type: "fill",
    selector: "#password",
    value: token,
  })
  await step("Submit sign-in again", { type: "press", key: "Enter" })
  await reject(
    "Reject external URL",
    { action: { type: "navigate" }, url: "https://example.com" },
    /limited to the Preview/
  )
  await reject(
    "Block external link navigation",
    { action: { type: "click", selector: "#external" } },
    /Preview|configured/
  )
  await step("Close authenticated session", { type: "close" }, "closed")
  sessionId = undefined
  await step("Start clean session", { type: "start" })
  await check("Closed session loses login", {
    type: "count",
    selector: "#password",
    value: 1,
  })
  record.status = "passed"
} catch (error) {
  record.status = "failed"
  record.error = error.message
  throw error
} finally {
  if (sessionId) {
    try {
      await step("Close browser", { type: "close" }, "closed")
    } catch (error) {
      record.cleanupError = error.message
    }
  }
  await save()
  console.log(`Browser Run result: ${record.status}. Evidence: ${recordPath}`)
}
