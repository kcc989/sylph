import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createCursor } from "cursor-opencode-provider"
import { modelsToConfig } from "cursor-opencode-provider/plugin"
import { discoverModels } from "cursor-opencode-provider/models"
import {
  buildLoginUrl,
  generatePkceParams,
  generatePkceChallenge,
  pollForTokens,
  resolveBearerToken,
} from "cursor-opencode-provider/auth"

if (process.argv.includes("--diagnostics")) await import("./diagnostics.mjs")

const modelId =
  process.argv.find((arg) => arg.startsWith("--model="))?.slice(8) ?? "grok-4.6"
const root = await mkdtemp(join(tmpdir(), "sylph-cursor-local-"))
await writeFile(
  join(root, "package.json"),
  JSON.stringify({ name: "cursor-local-proof" })
)
let accessToken = process.env.CURSOR_ACCESS_TOKEN
if (!accessToken && !process.env.CURSOR_API_KEY) {
  if (!process.argv.includes("--login")) {
    console.error(
      "Set CURSOR_API_KEY or CURSOR_ACCESS_TOKEN, or run with --login. Do not paste credentials into chat."
    )
    process.exit(2)
  }
  const params = generatePkceParams()
  const challenge = await generatePkceChallenge(params.verifier)
  console.log(
    JSON.stringify({
      status: "login_required",
      url: buildLoginUrl(challenge, params.uuid),
    })
  )
  const tokens = await pollForTokens(
    params.uuid,
    params.verifier,
    undefined,
    AbortSignal.timeout(600_000),
    200
  )
  accessToken = tokens.accessToken
}
accessToken = await resolveBearerToken({
  accessToken,
  apiKey: process.env.CURSOR_API_KEY,
})
const cacheDir = join(root, "cache")
const models = await discoverModels(accessToken, cacheDir)
const configuration = modelsToConfig(models)
const entry = configuration[modelId]
if (!entry) throw new Error(`Cursor did not advertise model ${modelId}`)
console.log(
  JSON.stringify({
    status: "connected",
    model: modelId,
    node: process.version,
    fixture: root,
  })
)
setTimeout(() => {
  console.error("Local Cursor probe exceeded its four-minute deadline")
  process.exit(1)
}, 240_000)
const provider = createCursor({
  name: "cursor",
  accessToken,
  cacheDir,
  workspaceRoot: root,
})
const model = provider.languageModel(entry.options?.cursorModelId ?? modelId)
let failed = false
for (const [withTool, maxMode] of process.argv.includes("--compare-max-mode")
  ? [
      [false, false],
      [false, true],
      [true, true],
    ]
  : [
      [false, process.argv.includes("--max-mode")],
      [true, process.argv.includes("--max-mode")],
    ]) {
  const test = `${withTool ? "read-tool" : "text-only"}-max-${maxMode}`
  const sessionId = `local-${test}-${crypto.randomUUID()}`
  const prompt = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: withTool
            ? "Read package.json using the read tool and report its package name. Do not modify files."
            : "Reply exactly CURSOR_LOCAL_OK. Do not use tools.",
        },
      ],
    },
  ]
  const abortSignal = AbortSignal.timeout(90_000)
  let text = ""
  let reads = 0
  let finished = false
  try {
    for (let step = 0; step < 5; step++) {
      const { stream } = await model.doStream({
        prompt,
        abortSignal,
        headers: withTool ? { "x-opencode-session": sessionId } : undefined,
        providerOptions: {
          cursor: {
            ...entry.options,
            maxMode,
          },
        },
        tools: withTool
          ? [
              {
                type: "function",
                name: "read",
                description: "Read a file in the workspace.",
                inputSchema: {
                  type: "object",
                  properties: { filePath: { type: "string" } },
                  required: ["filePath"],
                },
              },
            ]
          : undefined,
      })
      const calls = []
      for await (const part of stream) {
        if (part.type === "error") throw part.error
        if (part.type === "text-delta") text += part.delta
        if (part.type === "tool-call") calls.push(part)
        if (part.type === "finish") finished = true
      }
      if (!calls.length) break
      const results = []
      for (const call of calls) {
        const input = JSON.parse(call.input)
        const path = resolve(root, input.filePath ?? input.path ?? "")
        if (call.toolName !== "read" || path !== join(root, "package.json"))
          throw new Error(
            "Provider requested a tool or path outside the fixture"
          )
        const value = await readFile(path, "utf8")
        reads++
        prompt.push({
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              input,
            },
          ],
        })
        results.push({
          type: "tool-result",
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: { type: "text", value },
        })
      }
      prompt.push({ role: "tool", content: results })
      finished = false
    }
    const passed =
      finished &&
      (withTool
        ? reads > 0 && text.includes("cursor-local-proof")
        : text.trim() === "CURSOR_LOCAL_OK")
    failed ||= !passed
    console.log(JSON.stringify({ test, passed, reads, text }))
  } catch (error) {
    failed = true
    console.log(
      JSON.stringify({
        test,
        passed: false,
        name: error?.name,
        code: error?.code,
        message: error?.message ?? String(error),
      })
    )
  }
}
process.exit(failed ? 1 : 0)
