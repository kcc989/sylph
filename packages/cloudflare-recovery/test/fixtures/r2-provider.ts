import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"
import { expect } from "bun:test"
import { Layer, Schema } from "effect"
import { RecoveryQueryInput } from "@workspace/domain/cloudflare-recovery"
import {
  R2RecoveryCustomMetadata,
  R2RecoveryHttpMetadata,
  R2RecoveryStorageClass,
  type R2RecoveryObject,
} from "@workspace/domain/cloudflare-r2-recovery"
import { CloudflareD1RecoveryLive } from "../../src/recovery"
import { CloudflareR2RecoveryLive } from "../../src/r2"

export const r2Object = (
  key: string,
  bytes = "original"
): R2RecoveryObject => ({
  key,
  bytes: Buffer.from(bytes).toString("base64"),
  size: Buffer.byteLength(bytes),
  httpMetadata: {
    contentType: "application/octet-stream",
    cacheControl: "private, max-age=30",
  },
  customMetadata: { source: "fixture", owner: "private-value" },
  storageClass: "Standard",
})

export class R2Provider {
  control: Database
  apiToken: string
  objects = new Map<string, R2RecoveryObject>()
  buckets = new Map([["owned-bucket", this.objects]])
  mutationRequests: Array<{ bucketName: string; key: string; method: string }> =
    []
  afterMutation: (() => void) | undefined
  policyResponses = new Map<string, unknown>()
  policyStatuses = new Map<string, number>()
  policyRequests: Array<{ bucketName: string; kind: string; method: string }> =
    []
  afterPolicy: ((bucketName: string, kind: string) => void) | undefined
  generation = 0
  time = Date.now()
  mutations = 0
  reads = 0
  pages = 0
  pageSize = 1
  failMutation = 0
  lostMutation = 0
  dropMetadata = false
  dropHttpMetadata = false
  dropBytes = false
  failPage = false
  missingCompletion = false
  repeatCursor = false
  duplicatePage = false
  listingSize: number | undefined
  loseGate = false
  corruptChunk = false
  oversizedChunk = false
  querySizes: number[] = []
  paths: string[] = []
  constructor(control = new Database(":memory:"), apiToken = "fixture-token") {
    this.control = control
    this.apiToken = apiToken
    for (const name of ["control.sql", "r2-control.sql"])
      this.control.exec(
        readFileSync(new URL(`../../src/${name}`, import.meta.url), "utf8")
      )
    this.objects.set(
      "folder/a #雪",
      r2Object("folder/a #雪", "\u0000binary\u00ff")
    )
    this.objects.set("empty", r2Object("empty", ""))
  }
  fetch = async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers)
    expect(headers.get("authorization")).toBe(`Bearer ${this.apiToken}`)
    expect(init.redirect).toBe("manual")
    const path = new URL(url)
    if (path.pathname.endsWith("/query")) {
      const input = Schema.decodeUnknownSync(RecoveryQueryInput)(
        JSON.parse(String(init.body))
      )
      this.querySizes.push(Buffer.byteLength(String(init.body)))
      const results = this.control.query(input.sql).all(...input.params)
      if (this.corruptChunk && input.sql.startsWith("SELECT ordinal"))
        return Response.json({
          success: true,
          result: [
            {
              success: true,
              results: [
                {
                  ordinal: 0,
                  iv: btoa("i".repeat(12)),
                  ciphertext: btoa("corrupt"),
                },
              ],
            },
          ],
        })
      if (this.oversizedChunk && input.sql.startsWith("SELECT ordinal"))
        return Response.json({
          success: true,
          result: [
            {
              success: true,
              results: [
                {
                  ordinal: 0,
                  iv: btoa("i".repeat(12)),
                  ciphertext: "a".repeat(50000),
                },
              ],
            },
          ],
        })
      return Response.json({
        success: true,
        result: [{ success: true, results }],
      })
    }
    const policy = path.pathname.match(
      /\/r2\/buckets\/([a-z0-9-]+)\/(lifecycle|lock|sippy)$/
    )
    const notification = path.pathname.match(
      /\/event_notifications\/r2\/([a-z0-9-]+)\/configuration$/
    )
    if (policy || notification) {
      const bucketName = policy?.[1] ?? notification?.[1] ?? ""
      const kind = policy?.[2] ?? "notifications"
      if (!this.buckets.has(bucketName))
        throw new Error("Unexpected policy bucket")
      this.policyRequests.push({
        bucketName,
        kind,
        method: init.method ?? "GET",
      })
      const fallback =
        kind === "sippy"
          ? { enabled: false }
          : kind === "notifications"
            ? { bucketName, queues: [] }
            : { rules: [] }
      const result = this.policyResponses.has(kind)
        ? this.policyResponses.get(kind)
        : { success: true, result: fallback }
      this.afterPolicy?.(bucketName, kind)
      return Response.json(result, {
        status: this.policyStatuses.get(kind) ?? 200,
      })
    }
    this.paths.push(path.pathname)
    const match = path.pathname.match(
      /\/r2\/buckets\/([a-z0-9-]+)\/objects(?:\/(.*))?$/
    )
    if (!match) throw new Error("Unexpected resource")
    const bucketName = match[1] ?? ""
    const objects = this.buckets.get(bucketName)
    if (!objects) throw new Error("Unexpected bucket")
    if (match[2] === undefined) {
      this.pages++
      const start = Number(path.searchParams.get("cursor") ?? 0)
      if (start > 0 && this.failPage)
        return Response.json({ success: false }, { status: 500 })
      const prefix = path.searchParams.get("prefix") ?? ""
      const entries = [...objects.values()]
        .filter((value) => value.key.startsWith(prefix))
        .sort((left, right) =>
          left.key < right.key ? -1 : left.key > right.key ? 1 : 0
        )
      const selected = entries.slice(
        this.duplicatePage ? 0 : start,
        (this.duplicatePage ? 0 : start) + this.pageSize
      )
      const info = {
        cursor: String(this.repeatCursor ? 0 : start + this.pageSize),
        is_truncated: this.missingCompletion
          ? undefined
          : this.repeatCursor || start + this.pageSize < entries.length,
      }
      return Response.json({
        success: true,
        result: selected.map((value) => ({
          key: value.key,
          size: this.listingSize ?? value.size,
          etag: `generation-${this.generation}-${encodeURIComponent(value.key)}`,
          last_modified: "2026-09-07T00:00:00.000Z",
          ssec: false,
          storage_class: value.storageClass,
          custom_metadata: value.customMetadata,
          http_metadata: value.httpMetadata,
        })),
        result_info: info,
      })
    }
    const key = decodeURIComponent(match[2])
    if (init.method === "GET") {
      this.reads++
      const value = objects.get(key)
      if (!value) return new Response(null, { status: 404 })
      return new Response(Buffer.from(value.bytes, "base64"), {
        headers: {
          etag: `"generation-${this.generation}-${encodeURIComponent(value.key)}"`,
        },
      })
    }
    this.mutations++
    this.mutationRequests.push({
      bucketName,
      key,
      method: init.method ?? "GET",
    })
    if (this.mutations === this.failMutation)
      return new Response("private-provider-body", { status: 500 })
    if (init.method === "PUT") {
      let bytes = Buffer.from(await new Response(init.body).arrayBuffer())
      const httpMetadata = Schema.decodeUnknownSync(R2RecoveryHttpMetadata)(
        JSON.parse(headers.get("cf-r2-http-metadata") ?? "{}")
      )
      const customMetadata = Schema.decodeUnknownSync(R2RecoveryCustomMetadata)(
        JSON.parse(headers.get("cf-r2-custom-metadata") ?? "{}")
      )
      if (this.dropBytes) bytes = Buffer.from("xxxxxx")
      objects.set(key, {
        key,
        bytes: bytes.toString("base64"),
        size: bytes.length,
        httpMetadata: this.dropHttpMetadata ? {} : httpMetadata,
        customMetadata: this.dropMetadata ? {} : customMetadata,
        storageClass: Schema.decodeUnknownSync(R2RecoveryStorageClass)(
          headers.get("cf-r2-storage-class")
        ),
      })
    } else if (init.method === "DELETE") objects.delete(key)
    else throw new Error("Unexpected method")
    this.generation++
    this.afterMutation?.()
    if (this.loseGate)
      this.control.exec(
        "UPDATE sylph_recovery_gate SET owner = 'different-release'"
      )
    if (this.mutations === this.lostMutation)
      throw new Error("private-provider-body")
    return Response.json({ success: true })
  }
  configuration = () => ({
    accountId: "account",
    apiToken: this.apiToken,
    controlDatabaseId: "control",
    projectId: "project",
    encryptionKey: btoa("k".repeat(32)),
    fetch: this.fetch,
    now: () => this.time,
    bucketNames: [...this.buckets.keys()],
    drainTimeoutMs: 0,
  })
  layer = () =>
    Layer.merge(
      CloudflareR2RecoveryLive(this.configuration()),
      CloudflareD1RecoveryLive(this.configuration())
    )
  phase = () =>
    this.control
      .query(
        "SELECT phase FROM sylph_recovery_resource_operation WHERE resource_kind = 'r2' ORDER BY rowid DESC LIMIT 1"
      )
      .get()
}
