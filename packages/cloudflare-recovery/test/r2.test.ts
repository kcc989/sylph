import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CloudflareRecoveryFailure } from "@workspace/domain/cloudflare-recovery"
import { CloudflareD1Recovery } from "../src/recovery"
import { CloudflareR2Recovery } from "../src/r2"
import {
  R2Provider as Provider,
  r2Object as object,
} from "./fixtures/r2-provider"

const run = <A>(
  provider: Provider,
  program: (
    r2: CloudflareR2Recovery["Service"],
    gate: CloudflareD1Recovery["Service"]
  ) => Effect.Effect<A, CloudflareRecoveryFailure>
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* program(
        yield* CloudflareR2Recovery,
        yield* CloudflareD1Recovery
      )
    }).pipe(Effect.provide(provider.layer()))
  )
const capture = (provider: Provider, releaseId = "target") =>
  run(provider, (r2, gate) =>
    Effect.gen(function* () {
      yield* gate.pause(releaseId)
      return yield* r2.captureForDrill({
        bucketName: "owned-bucket",
        releaseId,
      })
    })
  )
const prepare = async (provider: Provider) => {
  const target = await capture(provider)
  await run(provider, (_, gate) => gate.adoptPause("target", "restore"))
  provider.objects.set("folder/a #雪", object("folder/a #雪", "changed"))
  provider.objects.delete("empty")
  provider.objects.set("extra", object("extra", "delete me"))
  provider.generation++
  const undo = await capture(provider, "restore")
  return { target, undo }
}

describe("complete R2 recovery", () => {
  test("restores paginated binary objects, metadata, empty objects and deletion; undo restores the newer bucket", async () => {
    const provider = new Provider()
    const original = new Map(provider.objects)
    const { target, undo } = await prepare(provider)
    const changed = new Map(provider.objects)
    const evidence = await run(provider, (r2) => r2.restore(target, "restore"))
    expect(evidence.objectCount).toBe(2)
    expect(provider.objects).toEqual(original)
    expect(provider.phase()).toEqual({ phase: "verified" })
    expect(provider.pages).toBeGreaterThan(10)
    expect(
      provider.paths.some((path) => path.endsWith("/folder/a%20%23%E9%9B%AA"))
    ).toBe(true)
    await run(provider, (r2, gate) =>
      Effect.gen(function* () {
        yield* gate.resume("restore")
        yield* gate.pause("undo")
        const point = yield* r2.capture({
          bucketName: "owned-bucket",
          releaseId: "undo",
        })
        expect(point.restoreVerifiedAt).toBe(evidence.verifiedAt)
        yield* r2.restore(undo, "undo")
        yield* gate.resume("undo")
      })
    )
    expect(provider.objects).toEqual(changed)
  })
  test("chunks encrypt bytes, keys and metadata, with bounded D1 rows", async () => {
    const provider = new Provider()
    provider.objects.set(
      "large-private-key",
      object("large-private-key", "private-contents".repeat(6000))
    )
    const manifest = await capture(provider)
    const rows = provider.control
      .query("SELECT ciphertext FROM sylph_recovery_r2_chunk")
      .all()
    expect(rows.length).toBeGreaterThan(3)
    expect(JSON.stringify(rows)).not.toContain("private-contents")
    expect(JSON.stringify(rows)).not.toContain("large-private-key")
    expect(JSON.stringify(rows)).not.toContain("private-value")
    expect(Math.max(...provider.querySizes)).toBeLessThan(45000)
    await run(provider, (r2) => r2.restore(manifest, "target"))
    expect(provider.phase()).toEqual({ phase: "verified" })
  })
  test.each([
    "failPage",
    "missingCompletion",
    "repeatCursor",
    "duplicatePage",
  ] as const)("rejects incomplete listing: %s", async (mode) => {
    const provider = new Provider()
    provider[mode] = true
    await expect(capture(provider)).rejects.toThrow()
    expect(provider.mutations).toBe(0)
    expect(
      provider.control.query("SELECT id FROM sylph_recovery_r2_manifest").all()
    ).toEqual([])
  })
  test("rejects unsupported object size before reading bytes", async () => {
    const provider = new Provider()
    provider.listingSize = 16 * 1024 * 1024 + 1
    await expect(capture(provider)).rejects.toThrow()
    expect(provider.reads).toBe(0)
    expect(provider.mutations).toBe(0)
  })
  test("rejects path-normalizing keys before sending an object request", async () => {
    const provider = new Provider()
    provider.objects.set("../outside", object("../outside"))
    await expect(capture(provider)).rejects.toThrow()
    expect(provider.reads).toBe(0)
  })
  test("requires a drained owned gate and a recent restore proof", async () => {
    const provider = new Provider()
    await expect(
      run(provider, (r2) =>
        r2.captureForDrill({ bucketName: "owned-bucket", releaseId: "wrong" })
      )
    ).rejects.toThrow()
    await run(provider, (_, gate) => gate.pause("target"))
    await expect(
      run(provider, (r2) =>
        r2.capture({ bucketName: "owned-bucket", releaseId: "target" })
      )
    ).rejects.toThrow()
    provider.control.exec("UPDATE sylph_recovery_gate SET active = 1")
    await expect(capture(provider)).rejects.toThrow()
    expect(provider.reads).toBe(0)
  })
  test.each(["corruptChunk", "oversizedChunk"] as const)(
    "preflights all encrypted chunks before mutations: %s",
    async (mode) => {
      const provider = new Provider()
      const { target } = await prepare(provider)
      provider[mode] = true
      await expect(
        run(provider, (r2) => r2.restore(target, "restore"))
      ).rejects.toThrow()
      expect(provider.mutations).toBe(0)
    }
  )
  test("rejects missing and cross-manifest chunks before mutations", async () => {
    const provider = new Provider()
    const { target, undo } = await prepare(provider)
    provider.control
      .query(
        "UPDATE sylph_recovery_r2_chunk SET iv = (SELECT iv FROM sylph_recovery_r2_chunk WHERE manifest_id = ? AND ordinal = 0), ciphertext = (SELECT ciphertext FROM sylph_recovery_r2_chunk WHERE manifest_id = ? AND ordinal = 0) WHERE manifest_id = ? AND ordinal = 0"
      )
      .run(undo.id, undo.id, target.id)
    await expect(
      run(provider, (r2) => r2.restore(target, "restore"))
    ).rejects.toThrow()
    provider.control
      .query("DELETE FROM sylph_recovery_r2_chunk WHERE manifest_id = ?")
      .run(target.id)
    await expect(
      run(provider, (r2) => r2.restore(target, "restore"))
    ).rejects.toThrow()
    expect(provider.mutations).toBe(0)
  })
  test("rejects stale undo and changes after the undo capture", async () => {
    const provider = new Provider()
    const { target } = await prepare(provider)
    provider.time += 16 * 60000
    await expect(
      run(provider, (r2) => r2.restore(target, "restore"))
    ).rejects.toThrow()
    await capture(provider, "restore")
    provider.objects.set("extra", object("extra", "concurrent update"))
    provider.generation++
    await expect(
      run(provider, (r2) => r2.restore(target, "restore"))
    ).rejects.toThrow()
    expect(provider.mutations).toBe(0)
  })
  test.each([1, 2, 3])(
    "partial mutation %i retains the pause and blocks resume",
    async (failure) => {
      const provider = new Provider()
      const { target } = await prepare(provider)
      provider.failMutation = failure
      const result = await run(provider, (r2) =>
        Effect.result(r2.restore(target, "restore"))
      )
      expect(JSON.stringify(result)).not.toContain("private-provider-body")
      expect(provider.phase()).toEqual({ phase: "uncertain" })
      expect(provider.mutations).toBe(failure)
      await expect(
        run(provider, (_, gate) => gate.resume("restore"))
      ).rejects.toThrow()
    }
  )
  test("lost mutation responses fail closed without automatic retries", async () => {
    const provider = new Provider()
    const { target } = await prepare(provider)
    provider.lostMutation = 1
    await expect(
      run(provider, (r2) => r2.restore(target, "restore"))
    ).rejects.toThrow()
    await expect(
      run(provider, (r2) => r2.restore(target, "restore"))
    ).rejects.toThrow()
    expect(provider.mutations).toBe(1)
    expect(provider.phase()).toEqual({ phase: "uncertain" })
    await expect(
      run(provider, (_, gate) => gate.resume("restore"))
    ).rejects.toThrow()
  })
  test("provider success that loses custom metadata is not verified recovery", async () => {
    const provider = new Provider()
    const { target } = await prepare(provider)
    provider.dropMetadata = true
    await expect(
      run(provider, (r2) => r2.restore(target, "restore"))
    ).rejects.toThrow()
    expect(provider.phase()).toEqual({ phase: "uncertain" })
    await expect(
      run(provider, (_, gate) => gate.resume("restore"))
    ).rejects.toThrow()
  })
  test("losing the gate stops the next object mutation", async () => {
    const provider = new Provider()
    const { target } = await prepare(provider)
    provider.loseGate = true
    await expect(
      run(provider, (r2) => r2.restore(target, "restore"))
    ).rejects.toThrow()
    expect(provider.mutations).toBe(1)
    expect(provider.phase()).toEqual({ phase: "uncertain" })
  })
  test("group preflight authenticates target and undo before any mutation", async () => {
    const provider = new Provider()
    const { target, undo } = await prepare(provider)
    await run(provider, (r2) => r2.verifySnapshot(target))
    await run(provider, (r2) => r2.preflightRestore(target, "restore"))
    expect(provider.mutations).toBe(0)
    provider.control
      .query("DELETE FROM sylph_recovery_r2_chunk WHERE manifest_id = ?")
      .run(undo.id)
    await expect(
      run(provider, (r2) => r2.preflightRestore(target, "restore"))
    ).rejects.toThrow()
    expect(provider.mutations).toBe(0)
    expect(provider.phase()).toBeNull()
  })
  test("expired, forged and foreign manifests fail before mutation", async () => {
    const provider = new Provider()
    const { target } = await prepare(provider)
    await expect(
      run(provider, (r2) =>
        r2.verifySnapshot({ ...target, bucketName: "foreign-bucket" })
      )
    ).rejects.toThrow()
    await expect(
      run(provider, (r2) => r2.verifySnapshot({ ...target, totalBytes: 0 }))
    ).rejects.toThrow()
    provider.time += 31 * 86400000
    await expect(
      run(provider, (r2) => r2.verifySnapshot(target))
    ).rejects.toThrow()
    expect(provider.mutations).toBe(0)
  })
  test("the allowlist blocks foreign bucket API requests", async () => {
    const provider = new Provider()
    await expect(
      run(provider, (r2) => r2.fingerprint("foreign-bucket"))
    ).rejects.toThrow()
    expect(provider.paths).toEqual([])
  })
  test("partial restore can be explicitly undone under a new release", async () => {
    const provider = new Provider()
    const { target, undo } = await prepare(provider)
    const before = new Map(provider.objects)
    provider.failMutation = 2
    await expect(
      run(provider, (r2) => r2.restore(target, "restore"))
    ).rejects.toThrow()
    await run(provider, (_, gate) => gate.adoptPause("restore", "reconcile"))
    await capture(provider, "reconcile")
    await run(provider, (r2, gate) =>
      Effect.gen(function* () {
        yield* r2.restore(undo, "reconcile")
        yield* gate.resume("reconcile")
      })
    )
    expect(provider.objects).toEqual(before)
  })
  test("empty restores cannot prove upload support, and reusable proof authenticates snapshot chunks", async () => {
    const empty = new Provider()
    empty.objects.clear()
    const target = await capture(empty)
    await run(empty, (_, gate) => gate.adoptPause("target", "restore"))
    empty.objects.set("extra", object("extra"))
    await capture(empty, "restore")
    await run(empty, (r2) => r2.restore(target, "restore"))
    await expect(run(empty, (r2) => r2.restoreProof())).rejects.toThrow()
    const provider = new Provider()
    const points = await prepare(provider)
    await run(provider, (r2) => r2.restore(points.target, "restore"))
    await run(provider, (r2) => r2.restoreProof())
    provider.corruptChunk = true
    await expect(run(provider, (r2) => r2.restoreProof())).rejects.toThrow()
  })
  test("restores Unicode custom metadata, all HTTP metadata, and storage class", async () => {
    const provider = new Provider()
    const value = {
      ...object("metadata"),
      customMetadata: { language: "雪☃️", author: "fixture" },
      httpMetadata: {
        contentType: "application/pdf",
        contentLanguage: "en-US",
        contentDisposition: "inline; filename=fixture.pdf",
        contentEncoding: "identity",
        cacheControl: "private, max-age=30",
        cacheExpiry: "2026-10-01T00:00:00.000Z",
      },
      storageClass: "InfrequentAccess" as const,
    }
    provider.objects.set(value.key, value)
    const { target } = await prepare(provider)
    provider.objects.delete(value.key)
    provider.generation++
    await capture(provider, "restore")
    await run(provider, (r2) => r2.restore(target, "restore"))
    expect(provider.objects.get(value.key)).toEqual(value)
  })
})
