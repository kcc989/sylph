import {
  CursorBridgeRequest,
  CursorTokens,
} from "@workspace/domain/cursor-provider"
import { Schema } from "effect"
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
const cacheDir = "/tmp/cursor-cache"

export const handleCursorRequest = async (request: Request) => {
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
      return Response.json(
        models
          .filter((model) => model.supportsAgent !== false)
          .map((model) => ({
            id: model.id,
            name: model.displayName ?? model.id,
            context: model.maxContext ?? 128_000,
            images: model.supportsImages ?? false,
          }))
      )
    }
    case "stream": {
      const provider = createCursor({
        name: "cursor",
        accessToken: input.accessToken,
        cacheDir,
        workspaceRoot: "/tmp/cursor-workspace",
        retry: { maxAttempts: 1 },
      })
      const result = await provider.languageModel(input.call.modelId).doStream({
        ...input.call.options,
        headers: { "x-opencode-session": input.call.sessionId },
        abortSignal: request.signal,
      })
      const encoder = new TextEncoder()
      return new Response(
        result.stream.pipeThrough(
          new TransformStream({
            transform(part, controller) {
              if (part.type === "raw") return
              const value =
                part.type === "error"
                  ? {
                      type: "error",
                      error:
                        "Cursor provider failed. Reconnect if your subscription has expired.",
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
