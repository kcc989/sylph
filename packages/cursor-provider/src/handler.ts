import { syncCursorWorkspace } from "./workspace"
import { cursorToolInput } from "./tool-input"
import { cursorModelStream } from "./model-stream"
import { cursorCatalog } from "./catalog"
import {
  CursorBridgeRequest,
  CursorTokens,
} from "@workspace/domain/cursor-provider"
import { Schema } from "effect"
import { cursorFailureMessage } from "./failure"
import { createCursor } from "cursor-opencode-provider"
import {
  buildLoginUrl,
  generatePkceParams,
  generatePkceChallenge,
  refreshAccessToken,
} from "cursor-opencode-provider/auth"
import { discoverModels } from "cursor-opencode-provider/models"

const decodeRequest = Schema.decodeUnknownPromise(CursorBridgeRequest)
const decodeTokens = Schema.decodeUnknownPromise(CursorTokens)

export const handleCursorRequest = async (
  request: Request,
  cacheDir = "/tmp/cursor-cache"
) => {
  const input = await decodeRequest(await request.json())
  switch (input.operation) {
    case "login": {
      const params = generatePkceParams()
      const challenge = await generatePkceChallenge(params.verifier)
      return Response.json({
        uuid: params.uuid,
        verifier: params.verifier,
        url: buildLoginUrl(challenge, params.uuid),
        expiresAt: Date.now() + 300_000,
      })
    }
    case "poll": {
      if (Date.now() >= input.login.expiresAt)
        return new Response(null, { status: 410 })
      const url = new URL("https://api2.cursor.sh/auth/poll")
      url.searchParams.set("uuid", input.login.uuid)
      url.searchParams.set("verifier", input.login.verifier)
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      if (response.status === 404) return new Response(null, { status: 202 })
      if (!response.ok) throw new Error("Cursor sign-in failed")
      return Response.json(await decodeTokens(await response.json()))
    }
    case "refresh":
      return Response.json(await refreshAccessToken(input.refreshToken))
    case "models": {
      const models = await discoverModels(input.accessToken, cacheDir)
      return Response.json(cursorCatalog(models))
    }
    case "stream": {
      await syncCursorWorkspace("/workspace", input.call.files)
      await discoverModels(input.accessToken, cacheDir)
      const provider = createCursor({
        name: "cursor",
        accessToken: input.accessToken,
        cacheDir,
        workspaceRoot: "/workspace",
      })
      const stream = cursorModelStream(
        provider.languageModel(input.call.modelId),
        {
          ...input.call.options,
          headers: { "x-opencode-session": input.call.sessionId },
          abortSignal: request.signal,
        }
      )
      const encoder = new TextEncoder()
      return new Response(
        stream.pipeThrough(
          new TransformStream({
            transform(rawPart, controller) {
              const part = cursorToolInput(rawPart)
              if (part.type === "raw") return
              const value =
                part.type === "error"
                  ? {
                      type: "error",
                      error:
                        part.error instanceof Error
                          ? cursorFailureMessage(part.error)
                          : "Cursor model request failed",
                    }
                  : part.type === "file" && part.data instanceof Uint8Array
                    ? {
                        ...part,
                        data: Buffer.from(part.data).toString("base64"),
                      }
                    : part
              controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`))
            },
          })
        ),
        {
          headers: {
            "content-type": "application/x-ndjson",
            "cache-control": "no-store",
          },
        }
      )
    }
  }
}
