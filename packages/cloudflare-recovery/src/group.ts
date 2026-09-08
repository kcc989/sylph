import { Context, Effect, Layer, Schema } from "effect"
import {
  CloudflareRecoveryFailure,
  D1RecoveryGroup,
  RecoveryQueryResponse,
  RecoveryTopology,
} from "@workspace/domain/cloudflare-recovery"
import { CloudflareD1Recovery, type RecoveryConfiguration } from "./recovery"

type Result<A> = Effect.Effect<A, CloudflareRecoveryFailure>
type Capture = { releaseId: string; liveReleaseId?: string }

export class CloudflareRecoveryGroup extends Context.Service<
  CloudflareRecoveryGroup,
  {
    capture: (input: Capture) => Result<D1RecoveryGroup>
    captureForDrill: (input: Capture) => Result<D1RecoveryGroup>
    restore: (id: string, releaseId: string) => Result<D1RecoveryGroup>
    read: (id: string) => Result<D1RecoveryGroup>
  }
>()("@sylph/CloudflareRecoveryGroup") {}

const digest = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
    ),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("")

export const CloudflareRecoveryGroupLive = (
  configuration: RecoveryConfiguration & { topology: RecoveryTopology }
) =>
  Layer.effect(
    CloudflareRecoveryGroup,
    Effect.gen(function* () {
      const recovery = yield* CloudflareD1Recovery
      const topology = Schema.decodeUnknownSync(RecoveryTopology)(
        configuration.topology
      )
      const ids = [
        ...new Set(topology.workers.flatMap((worker) => worker.databaseIds)),
      ].sort()
      const now = configuration.now ?? Date.now
      const topologyJson = JSON.stringify(topology)
      const fail = (operation: string) =>
        new CloudflareRecoveryFailure({
          operation,
          message: `${operation} failed; keep writers paused and inspect the saved group operation.`,
        })
      const attempt = <A>(
        operation: string,
        run: () => Promise<A>
      ): Result<A> =>
        Effect.tryPromise({ try: run, catch: () => fail(operation) })
      const query = (
        sql: string,
        params: readonly (string | number | null)[] = []
      ) =>
        attempt("Access recovery group", async () => {
          const root =
            configuration.apiBaseUrl ??
            `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(configuration.accountId)}`
          const response = await (configuration.fetch ?? fetch)(
            `${root}/d1/database/${encodeURIComponent(configuration.controlDatabaseId)}/query`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${configuration.apiToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ sql, params }),
              redirect: "error",
              signal: AbortSignal.timeout(60000),
            }
          )
          if (!response.ok) throw new Error("Control database rejected query")
          const result = Schema.decodeUnknownSync(RecoveryQueryResponse)(
            await response.json()
          )
          if (
            !result.success ||
            result.result.length !== 1 ||
            !result.result[0]?.success
          )
            throw new Error("Control database query failed")
          return result.result[0].results
        })
      const paused = Effect.fn("RecoveryGroup.paused")(function* (
        releaseId: string
      ) {
        const gate = yield* recovery.gate()
        if (gate.owner !== releaseId || gate.active !== 0)
          return yield* fail("Require drained group")
      })
      const read = Effect.fn("RecoveryGroup.read")(function* (id: string) {
        const rows = yield* query(
          "SELECT json, sha256 FROM sylph_recovery_group WHERE id = ? AND project_id = ?",
          [id, configuration.projectId]
        )
        return yield* attempt("Read immutable recovery group", async () => {
          const json = Schema.decodeUnknownSync(Schema.String)(rows[0]?.json)
          if ((await digest(json)) !== rows[0]?.sha256)
            throw new Error("Group integrity mismatch")
          const group = Schema.decodeUnknownSync(D1RecoveryGroup)(
            JSON.parse(json)
          )
          if (
            group.id !== id ||
            group.projectId !== configuration.projectId ||
            JSON.stringify(group.topology) !== topologyJson
          )
            throw new Error("Group identity or topology differs")
          if (
            JSON.stringify(
              group.databases.map((point) => point.databaseId).sort()
            ) !== JSON.stringify(ids)
          )
            throw new Error("Group must cover each application database once")
          if (
            group.databases.some(
              (point) =>
                point.releaseId !== group.releaseId ||
                point.projectId !== group.projectId ||
                point.expiresAt < group.expiresAt
            )
          )
            throw new Error("Group contains mismatched recovery points")
          return group
        })
      })
      const capture = Effect.fn("RecoveryGroup.capture")(function* (
        input: Capture,
        drill: boolean
      ) {
        yield* paused(input.releaseId)
        yield* recovery.inventoryTopology(topology)
        const databases: Array<D1RecoveryGroup["databases"][number]> = []
        for (const databaseId of ids)
          databases.push(
            yield* (drill ? recovery.captureForDrill : recovery.capture)({
              ...input,
              databaseId,
            })
          )
        for (const point of databases) {
          const actual = yield* recovery.fingerprint(point.databaseId)
          if (actual.fingerprint !== point.fingerprint)
            return yield* fail("Database changed during group capture")
        }
        yield* paused(input.releaseId)
        const group = Schema.decodeUnknownSync(D1RecoveryGroup)({
          version: 1,
          id: crypto.randomUUID(),
          projectId: configuration.projectId,
          releaseId: input.releaseId,
          capturedAt: now(),
          expiresAt: Math.min(...databases.map((point) => point.expiresAt)),
          topology,
          databases,
        })
        const json = JSON.stringify(group)
        const hash = yield* attempt("Hash recovery group", () => digest(json))
        yield* query(
          "INSERT INTO sylph_recovery_group (id, release_id, project_id, json, sha256) VALUES (?, ?, ?, ?, ?)",
          [group.id, group.releaseId, group.projectId, json, hash]
        )
        return yield* read(group.id)
      })
      const restore = Effect.fn("RecoveryGroup.restore")(function* (
        id: string,
        releaseId: string
      ) {
        yield* paused(releaseId)
        yield* recovery.inventoryTopology(topology)
        const target = yield* read(id)
        if (target.expiresAt <= now() || target.capturedAt > now())
          return yield* fail("Require unexpired recovery group")
        const rows = yield* query(
          "SELECT id FROM sylph_recovery_group WHERE project_id = ? AND release_id = ? ORDER BY rowid DESC LIMIT 1",
          [configuration.projectId, releaseId]
        )
        const undoId = yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(
          rows[0]?.id
        ).pipe(Effect.mapError(() => fail("Require complete undo group")))
        const undo = yield* read(undoId)
        if (
          undo.expiresAt <= now() ||
          undo.capturedAt < now() - 15 * 60000 ||
          undo.capturedAt > now()
        )
          return yield* fail("Require fresh undo group")
        for (const point of [...target.databases, ...undo.databases]) {
          const saved = yield* recovery.readManifest(point.id)
          if (
            JSON.stringify(saved) !== JSON.stringify(point) ||
            point.expiresAt <= now()
          )
            return yield* fail("Require matching immutable group members")
          yield* recovery.secrets(saved)
        }
        for (const point of undo.databases) {
          const actual = yield* recovery.fingerprint(point.databaseId)
          if (actual.fingerprint !== point.fingerprint)
            return yield* fail("Undo group no longer matches current data")
        }
        yield* paused(releaseId)
        yield* query(
          "INSERT INTO sylph_recovery_group_operation (release_id, group_id, phase) VALUES (?, ?, 'restoring')",
          [releaseId, id]
        )
        const program = Effect.gen(function* () {
          for (const point of target.databases)
            yield* recovery.restore(point, releaseId)
          for (const point of target.databases) {
            const actual = yield* recovery.fingerprint(point.databaseId)
            if (actual.fingerprint !== point.fingerprint)
              return yield* fail("Verify coordinated restored data")
          }
          yield* paused(releaseId)
          yield* query(
            "UPDATE sylph_recovery_group_operation SET phase = 'verified' WHERE release_id = ? AND group_id = ? AND phase = 'restoring'",
            [releaseId, id]
          )
          return target
        })
        return yield* program.pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              yield* query(
                "UPDATE sylph_recovery_group_operation SET phase = 'uncertain' WHERE release_id = ? AND group_id = ? AND phase = 'restoring'",
                [releaseId, id]
              )
              return yield* error
            })
          )
        )
      })
      return CloudflareRecoveryGroup.of({
        capture: (input) => capture(input, false),
        captureForDrill: (input) => capture(input, true),
        restore,
        read,
      })
    })
  )
