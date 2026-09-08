import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { CloudflareD1Recovery } from "../src/recovery"
import { CloudflareR2Recovery } from "../src/r2"
import { verifyR2RecoveryDrill } from "../src/r2-drill"
import { R2Provider, r2Object } from "./fixtures/r2-provider"

const scratch = "sylph-0123456789abcdef01234567-recovery-drill"
const fixture = () => {
  const provider = new R2Provider()
  provider.buckets.set(scratch, new Map())
  provider.buckets.set(
    "second-app-bucket",
    new Map([["private-second", r2Object("private-second", "retained")]])
  )
  return provider
}
const input = () => ({
  bucketName: scratch,
  applicationBucketNames: ["owned-bucket", "second-app-bucket"],
  releaseId: "r2-drill",
})
const run = (provider: R2Provider, value = input()) =>
  Effect.runPromise(
    verifyR2RecoveryDrill(provider.configuration(), value).pipe(
      Effect.provide(provider.layer())
    )
  )
const owner = (provider: R2Provider) =>
  provider.control.query("SELECT owner FROM sylph_recovery_gate").get()

describe("R2 recovery drill", () => {
  test("proves metadata and byte PUT, extra-object DELETE, and unchanged application buckets", async () => {
    const provider = fixture()
    const application = structuredClone([...provider.objects])
    const second = structuredClone([
      ...(provider.buckets.get("second-app-bucket") ?? []),
    ])
    const existing = r2Object("prior-scratch-fixture", "keep this")
    provider.buckets.get(scratch)?.set(existing.key, existing)
    const evidence = await run(provider)
    expect(
      provider.mutationRequests.every(
        (request) => request.bucketName === scratch
      )
    ).toBe(true)
    expect(
      provider.mutationRequests.some((request) => request.method === "PUT")
    ).toBe(true)
    expect(
      provider.mutationRequests.filter((request) => request.method === "DELETE")
    ).toHaveLength(1)
    expect([...provider.objects]).toEqual(application)
    expect([...(provider.buckets.get("second-app-bucket") ?? [])]).toEqual(
      second
    )
    expect(provider.buckets.get(scratch)?.get(existing.key)).toEqual(existing)
    const seed = [...(provider.buckets.get(scratch)?.values() ?? [])].find(
      (object) => object.key.startsWith("sylph-recovery-drill-")
    )
    expect(seed?.bytes).toBe(Buffer.from("before").toString("base64"))
    expect(seed?.customMetadata).toEqual({ sylphDrill: "before" })
    expect(seed?.httpMetadata).toEqual({
      contentType: "text/plain",
      cacheControl: "no-store",
    })
    expect(evidence.objectCount).toBe(2)
    expect(owner(provider)).toEqual({ owner: null })
    await Effect.runPromise(
      Effect.gen(function* () {
        const r2 = yield* CloudflareR2Recovery
        expect((yield* r2.restoreProof()).manifestId).toBe(evidence.manifestId)
      }).pipe(Effect.provide(provider.layer()))
    )
  })
  test.each(["dropMetadata", "dropHttpMetadata", "dropBytes"] as const)(
    "rejects initial provider write that loses %s",
    async (mode) => {
      const provider = fixture()
      provider[mode] = true
      await expect(run(provider)).rejects.toThrow()
      expect(provider.mutations).toBe(1)
      expect(provider.phase()).toBeNull()
      expect(owner(provider)).toEqual({ owner: "r2-drill" })
    }
  )
  test.each([1, 2, 3, 4, 5])(
    "provider failure at mutation %i retains the pause and never touches application buckets",
    async (failure) => {
      const provider = fixture()
      const application = new Map(provider.objects)
      provider.failMutation = failure
      await expect(run(provider)).rejects.toThrow()
      expect(provider.mutations).toBe(failure)
      expect(provider.objects).toEqual(application)
      expect(
        provider.mutationRequests.every(
          (request) => request.bucketName === scratch
        )
      ).toBe(true)
      expect(owner(provider)).toEqual({ owner: "r2-drill" })
    }
  )
  test("a lost first write response retains the fixture and does not retry", async () => {
    const provider = fixture()
    provider.lostMutation = 1
    const outcome = await Effect.runPromise(
      Effect.result(
        verifyR2RecoveryDrill(provider.configuration(), input())
      ).pipe(Effect.provide(provider.layer()))
    )
    expect(JSON.stringify(outcome)).not.toContain("private-provider-body")
    expect(provider.mutations).toBe(1)
    expect(provider.buckets.get(scratch)?.size).toBe(1)
    expect(owner(provider)).toEqual({ owner: "r2-drill" })
  })
  test("detects changed application bytes before resuming writers", async () => {
    const provider = fixture()
    provider.afterMutation = () =>
      provider.objects.set(
        "outside-write",
        r2Object("outside-write", "unexpected")
      )
    await expect(run(provider)).rejects.toThrow()
    expect(owner(provider)).toEqual({ owner: "r2-drill" })
    expect(
      provider.mutationRequests.every(
        (request) => request.bucketName === scratch
      )
    ).toBe(true)
  })
  test("rejects a missing, foreign or application scratch bucket and incomplete application inventory", async () => {
    for (const value of [
      { ...input(), bucketName: "owned-bucket" },
      { ...input(), bucketName: "foreign-bucket" },
      {
        ...input(),
        bucketName: "sylph-ffffffffffffffffffffffff-recovery-drill",
      },
      { ...input(), applicationBucketNames: ["owned-bucket"] },
      {
        ...input(),
        applicationBucketNames: [
          "owned-bucket",
          "owned-bucket",
          "second-app-bucket",
        ],
      },
      {
        ...input(),
        applicationBucketNames: [...input().applicationBucketNames, scratch],
      },
    ]) {
      const provider = fixture()
      await expect(run(provider, value)).rejects.toThrow()
      expect(provider.mutations).toBe(0)
      expect(provider.paths).toEqual([])
    }
  })
  test("an existing writer pause cannot be stolen by the drill", async () => {
    const provider = fixture()
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* (yield* CloudflareD1Recovery).pause("another-release")
      }).pipe(Effect.provide(provider.layer()))
    )
    await expect(run(provider)).rejects.toThrow()
    expect(provider.mutations).toBe(0)
    expect(owner(provider)).toEqual({ owner: "another-release" })
  })
  test("a lost gate stops subsequent fixture mutations", async () => {
    const provider = fixture()
    provider.loseGate = true
    await expect(run(provider)).rejects.toThrow()
    expect(provider.mutations).toBe(1)
    expect(owner(provider)).toEqual({ owner: "different-release" })
  })
  test("metadata lost during restore keeps its operation uncertain and writers paused", async () => {
    const provider = fixture()
    provider.afterMutation = () => {
      if (provider.mutations === 3) provider.dropMetadata = true
    }
    await expect(run(provider)).rejects.toThrow()
    expect(provider.phase()).toEqual({ phase: "uncertain" })
    expect(owner(provider)).toEqual({ owner: "r2-drill" })
  })
  test("supports twenty application buckets plus the reserved scratch bucket", async () => {
    const provider = fixture()
    const applicationBucketNames = [...input().applicationBucketNames]
    for (let index = 0; index < 18; index++) {
      const name = `application-bucket-${index}`
      applicationBucketNames.push(name)
      provider.buckets.set(name, new Map())
    }
    await run(provider, { ...input(), applicationBucketNames })
    expect(owner(provider)).toEqual({ owner: null })
    expect(
      provider.mutationRequests.every(
        (request) => request.bucketName === scratch
      )
    ).toBe(true)
  })
})
