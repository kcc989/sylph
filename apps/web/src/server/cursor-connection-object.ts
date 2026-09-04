import { DurableObject } from "cloudflare:workers"
import { Schema } from "effect"
import {
  CursorBridgeRequest,
  CursorCompletedLogin,
  CursorConnection,
  CursorLogin,
  CursorModels,
  CursorRuntimeRequest,
  CursorStoredSecret,
  CursorTokens,
} from "@workspace/domain/cursor-provider"
import { cursorTokenExpiresAt } from "./cursor-token-expiry"
import { encryptCredential, decryptCredential } from "./credentials.server"

const decodeCompleted = Schema.decodeUnknownPromise(CursorCompletedLogin)
const decodeLogin = Schema.decodeUnknownPromise(CursorLogin)
const decodeConnection = Schema.decodeUnknownPromise(CursorConnection)
const decodeTokens = Schema.decodeUnknownPromise(CursorTokens)
const decodeSecret = Schema.decodeUnknownPromise(CursorStoredSecret)
const decodeRequest = Schema.decodeUnknownPromise(CursorRuntimeRequest)
const decodeModels = Schema.decodeUnknownPromise(CursorModels)

export class CursorConnectionObject extends DurableObject<{
  CREDENTIAL_ENCRYPTION_KEY: string
}> {
  #pending: Promise<void> = Promise.resolve()
  #native:
    | Promise<
        ReturnType<
          typeof import("@workspace/cursor-provider/worker").createWorkerCursorHandler
        >
      >
    | undefined

  #exclusive<T>(run: () => Promise<T>): Promise<T> {
    const result = this.#pending.then(run)
    this.#pending = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  async #send(input: typeof CursorBridgeRequest.Type, signal?: AbortSignal) {
    this.#native ??= import("@workspace/cursor-provider/worker").then(
      ({ createWorkerCursorHandler }) =>
        createWorkerCursorHandler(this.ctx.id.toString())
    )
    const native = await this.#native
    return native.fetch(
      new Request("http://cursor/", {
        method: "POST",
        body: JSON.stringify(input),
        signal,
      })
    )
  }

  async #write(name: string, value: string) {
    const encrypted = await encryptCredential(
      value,
      this.env.CREDENTIAL_ENCRYPTION_KEY
    )
    await this.ctx.storage.put(name, encrypted)
  }

  async #read(name: string) {
    const stored = await this.ctx.storage.get(name)
    if (!stored) return null
    const secret = await decodeSecret(stored)
    return JSON.parse(
      await decryptCredential(
        secret.encrypted,
        secret.iv,
        this.env.CREDENTIAL_ENCRYPTION_KEY
      )
    )
  }

  async startLogin() {
    return this.#exclusive(async () => {
      await this.ctx.storage.delete("completed")
      const response = await this.#send({ operation: "login" })
      if (!response.ok) throw new Error("Could not start Cursor sign-in")
      const login = await decodeLogin(await response.json())
      await this.#write("login", JSON.stringify(login))
      return {
        attemptId: login.uuid,
        url: login.url,
        expiresAt: login.expiresAt,
        instructions: "Sign in with your Cursor account.",
      }
    })
  }

  async cancelLogin(attemptId: string) {
    return this.#exclusive(async () => {
      const stored = await this.#read("login")
      if (stored && (await decodeLogin(stored)).uuid === attemptId)
        await this.ctx.storage.delete("login")
    })
  }

  async pollLogin(attemptId: string) {
    return this.#exclusive(async () => {
      const completed = await this.#read("completed")
      if (completed) {
        const result = await decodeCompleted(completed)
        if (result.attemptId === attemptId && result.expiresAt > Date.now())
          return {
            status: "complete" as const,
            key: result.key,
            models: result.models,
          }
      }
      const stored = await this.#read("login")
      if (!stored) return { status: "expired" as const }
      const login = await decodeLogin(stored)
      if (login.uuid !== attemptId || login.expiresAt <= Date.now())
        return { status: "expired" as const }
      const response = await this.#send({ operation: "poll", login })
      if (response.status === 202) return { status: "pending" as const }
      if (!response.ok) return { status: "failed" as const }
      const tokens = await decodeTokens(await response.json())
      const catalog = await this.#send({
        operation: "models",
        accessToken: tokens.accessToken,
      })
      if (!catalog.ok) throw new Error("Cursor model discovery failed")
      const models = await decodeModels(await catalog.json())
      if (models.length === 0)
        throw new Error("Cursor returned no available models")
      if (await this.#read("connection")) {
        ;(await this.#native)?.dispose()
        this.#native = undefined
      }
      const key = crypto.randomUUID()
      await this.#write(
        "connection",
        JSON.stringify({ key, tokens, refreshedAt: Date.now() })
      )
      await this.#write(
        "completed",
        JSON.stringify({
          attemptId,
          key,
          models,
          expiresAt: Date.now() + 300_000,
        })
      )
      await this.ctx.storage.delete("login")
      return { status: "complete" as const, key, models }
    })
  }

  async disconnect() {
    await this.#exclusive(async () => {
      await this.ctx.storage.deleteAll()
      const native = await this.#native
      native?.dispose()
      this.#native = undefined
    })
  }

  override async fetch(request: Request) {
    const input = await decodeRequest(await request.json())
    return this.#exclusive(async () => {
      const stored = await this.#read("connection")
      if (!stored)
        return new Response("Connect your Cursor account", { status: 401 })
      let connection = await decodeConnection(stored)
      if (connection.key !== input.key)
        return new Response("Cursor connection was removed", { status: 401 })
      if (
        cursorTokenExpiresAt(connection.tokens.accessToken) - Date.now() <
        300_000
      ) {
        const refreshed = await this.#send({
          operation: "refresh",
          refreshToken: connection.tokens.refreshToken,
        })
        if (!refreshed.ok) throw new Error("Reconnect your Cursor account")
        connection = {
          ...connection,
          tokens: await decodeTokens(await refreshed.json()),
          refreshedAt: Date.now(),
        }
        await this.#write("connection", JSON.stringify(connection))
      }
      if (input.operation === "models")
        return this.#send(
          { operation: "models", accessToken: connection.tokens.accessToken },
          request.signal
        )
      return this.#send(
        {
          operation: "stream",
          accessToken: connection.tokens.accessToken,
          call: input.call,
        },
        request.signal
      )
    })
  }
}
