import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { RecoveryQueryInput } from "@workspace/domain/cloudflare-recovery"
import { CloudflareD1Recovery, CloudflareD1RecoveryLive } from "../src/recovery"

class Provider {
  control = new Database(":memory:")
  application = new Database(":memory:")
  saved = new Map<string, Buffer>()
  current = "bookmark-1"
  restoreCalls = 0
  time = Date.now()
  corruptRestore = false
  failRestore = false
  bindings = [
    { name: "DB", type: "d1", id: "app" },
    { name: "SYLPH_RECOVERY_CONTROL", type: "d1", id: "control" },
  ]
  constructor() {
    this.control.exec(
      readFileSync(new URL("../src/control.sql", import.meta.url), "utf8")
    )
    this.application.exec(
      "CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL); INSERT INTO notes VALUES ('one', 'original')"
    )
  }
  fetch = async (url: string, init: RequestInit) => {
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer test-token"
    )
    expect(init.redirect).toBe("error")
    const path = new URL(url)
    if (path.pathname.endsWith("/settings"))
      return Response.json({
        success: true,
        result: { bindings: this.bindings },
      })
    if (path.pathname.endsWith("/schedules"))
      return Response.json({ success: true, result: { schedules: [] } })
    if (path.pathname.endsWith("/query")) {
      const input = Schema.decodeUnknownSync(RecoveryQueryInput)(
        JSON.parse(String(init.body))
      )
      const database = path.pathname.includes("/control/")
        ? this.control
        : this.application
      const results = database.query(input.sql).all(...input.params)
      return Response.json({
        success: true,
        result: [{ success: true, results }],
      })
    }
    if (path.pathname.endsWith("/bookmark")) {
      this.saved.set(this.current, this.application.serialize())
      return Response.json({
        success: true,
        result: { bookmark: this.current },
      })
    }
    if (path.pathname.endsWith("/restore")) {
      this.restoreCalls++
      if (this.failRestore)
        return new Response("sensitive-provider-output", { status: 500 })
      const saved = this.saved.get(path.searchParams.get("bookmark") ?? "")
      if (!saved) return new Response("Missing bookmark", { status: 400 })
      this.application = Database.deserialize(saved)
      if (this.corruptRestore)
        this.application.exec("UPDATE notes SET body = 'wrong'")
      return Response.json({
        success: true,
        result: { bookmark: "restored", previous_bookmark: "undo" },
      })
    }
    throw new Error("Unexpected API request")
  }
  layer = () =>
    CloudflareD1RecoveryLive({
      accountId: "account",
      apiToken: "test-token",
      controlDatabaseId: "control",
      projectId: "project",
      encryptionKey: btoa("k".repeat(32)),
      fetch: this.fetch,
      drainTimeoutMs: 0,
      now: () => this.time,
    })
}

const run = <A>(
  provider: Provider,
  program: (
    service: CloudflareD1Recovery["Service"]
  ) => Effect.Effect<
    A,
    import("@workspace/domain/cloudflare-recovery").CloudflareRecoveryFailure
  >
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* program(yield* CloudflareD1Recovery)
    }).pipe(Effect.provide(provider.layer()))
  )

const drill = (provider: Provider) =>
  run(provider, (service) =>
    Effect.gen(function* () {
      yield* service.pause("drill")
      const manifest = yield* service.captureForDrill({
        databaseId: "app",
        releaseId: "drill",
      })
      provider.application.exec("UPDATE notes SET body = 'changed'")
      provider.current = "bookmark-2"
      const evidence = yield* service.restore(manifest, "drill")
      yield* service.resume("drill")
      return { manifest, evidence }
    })
  )

describe("Cloudflare D1 recovery", () => {
  test("restore checks actual schema and every bounded row, then permits release capture", async () => {
    const provider = new Provider()
    const result = await drill(provider)
    expect(result.evidence.previousBookmark).toBe("undo")
    expect(provider.application.query("SELECT body FROM notes").get()).toEqual({
      body: "original",
    })
    const point = await run(provider, (service) =>
      Effect.gen(function* () {
        yield* service.pause("release")
        return yield* service.capture({
          databaseId: "app",
          releaseId: "release",
        })
      })
    )
    expect(point.restoreVerifiedAt).toBe(result.evidence.verifiedAt)
  })

  test("ordinary capture cannot fabricate restore proof", async () => {
    const provider = new Provider()
    await expect(
      run(provider, (service) =>
        Effect.gen(function* () {
          yield* service.pause("release")
          return yield* service.capture({
            databaseId: "app",
            releaseId: "release",
          })
        })
      )
    ).rejects.toThrow()
    expect(
      provider.control.query("SELECT owner FROM sylph_recovery_gate").get()
    ).toEqual({ owner: "release" })
  })

  test("a successful provider receipt with wrong restored data fails closed", async () => {
    const provider = new Provider()
    provider.corruptRestore = true
    await expect(drill(provider)).rejects.toThrow()
    expect(
      provider.control.query("SELECT phase FROM sylph_recovery_operation").get()
    ).toEqual({ phase: "uncertain" })
    expect(
      provider.control.query("SELECT owner FROM sylph_recovery_gate").get()
    ).toEqual({ owner: "drill" })
  })

  test("lost restore responses are not retried and do not expose provider output", async () => {
    const provider = new Provider()
    await run(provider, (service) =>
      Effect.gen(function* () {
        yield* service.pause("drill")
        const point = yield* service.captureForDrill({
          databaseId: "app",
          releaseId: "drill",
        })
        provider.failRestore = true
        const first = yield* Effect.result(service.restore(point, "drill"))
        expect(JSON.stringify(first)).not.toContain("sensitive-provider-output")
        yield* Effect.result(service.restore(point, "drill"))
      })
    )
    expect(provider.restoreCalls).toBe(1)
  })

  test("pause drains before capture and another release cannot steal it", async () => {
    const provider = new Provider()
    provider.control.exec("UPDATE sylph_recovery_gate SET active = 1")
    await expect(
      run(provider, (service) => service.pause("one"))
    ).rejects.toThrow()
    await expect(
      run(provider, (service) => service.pause("two"))
    ).rejects.toThrow()
    provider.control.exec("UPDATE sylph_recovery_gate SET active = 0")
    await run(provider, (service) => service.adoptPause("one", "two"))
    await expect(
      run(provider, (service) => service.resume("one"))
    ).rejects.toThrow()
  })

  test("captures exact previously deployed secrets in encrypted immutable versions", async () => {
    const provider = new Provider()
    await drill(provider)
    await run(provider, (service) =>
      Effect.gen(function* () {
        yield* service.stageSecrets("live", {
          BETTER_AUTH_SECRET: "prior-auth-secret",
        })
        yield* service.stageSecrets("future", {
          BETTER_AUTH_SECRET: "different-target-value",
        })
        yield* service.pause("release")
        const point = yield* service.capture({
          databaseId: "app",
          releaseId: "release",
          liveReleaseId: "live",
        })
        expect(JSON.stringify(point)).not.toContain("prior-auth-secret")
        expect(yield* service.secrets(point)).toEqual({
          BETTER_AUTH_SECRET: "prior-auth-secret",
        })
        const overwritten = yield* Effect.result(
          service.stageSecrets("live", { BETTER_AUTH_SECRET: "other" })
        )
        expect(overwritten._tag).toBe("Failure")
      })
    )
    expect(
      provider.control.serialize().includes(Buffer.from("prior-auth-secret"))
    ).toBe(false)
  })

  test("unknown storage and extra database bindings block inventory", async () => {
    const provider = new Provider()
    await run(provider, (service) =>
      service.inventory({
        workerName: "worker",
        databaseId: "app",
        secretNames: [],
      })
    )
    provider.bindings.push({ name: "BUCKET", type: "r2_bucket", id: "bucket" })
    await expect(
      run(provider, (service) =>
        service.inventory({
          workerName: "worker",
          databaseId: "app",
          secretNames: [],
        })
      )
    ).rejects.toThrow()
  })

  test("tampered manifest and expired point fail before restore", async () => {
    const provider = new Provider()
    const result = await drill(provider)
    await run(provider, (service) => service.pause("next"))
    await expect(
      run(provider, (service) =>
        service.restore({ ...result.manifest, expiresAt: 0 }, "next")
      )
    ).rejects.toThrow()
    expect(provider.restoreCalls).toBe(1)
    provider.control.exec("UPDATE sylph_recovery_manifest SET json = '{}'")
    await expect(
      run(provider, (service) => service.readManifest(result.manifest.id))
    ).rejects.toThrow()
  })

  test("missing baseline secret versions fail instead of using current config", async () => {
    const provider = new Provider()
    await drill(provider)
    await expect(
      run(provider, (service) =>
        Effect.gen(function* () {
          yield* service.pause("release")
          return yield* service.capture({
            databaseId: "app",
            releaseId: "release",
            liveReleaseId: "missing",
          })
        })
      )
    ).rejects.toThrow()
  })
  test("expiration blocks an intact saved manifest before provider restore", async () => {
    const provider = new Provider()
    const { manifest } = await drill(provider)
    provider.time += 7 * 86400000
    await run(provider, (service) => service.pause("expired"))
    await expect(
      run(provider, (service) => service.restore(manifest, "expired"))
    ).rejects.toThrow()
    expect(provider.restoreCalls).toBe(1)
  })

  test("similarly named application tables are included in the fingerprint", async () => {
    const provider = new Provider()
    provider.application.exec(
      "CREATE TABLE acfb_notes (value TEXT); INSERT INTO acfb_notes VALUES ('before')"
    )
    const before = await run(provider, (service) => service.fingerprint("app"))
    provider.application.exec("UPDATE acfb_notes SET value = 'after'")
    const after = await run(provider, (service) => service.fingerprint("app"))
    expect(after.fingerprint).not.toBe(before.fingerprint)
  })
})
