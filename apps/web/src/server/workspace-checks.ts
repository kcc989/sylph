import {
  decodeWorkspaceCheckRun,
  type WorkspaceCheckEvidence,
  WorkspaceCheckRun,
  WorkspaceCheckStage,
  type WorkspaceCheckStageName,
  type WorkspaceCheckUpdate,
} from "@workspace/domain"

import type { WorkspaceStorage } from "./workspace-filesystem"

type CheckRow = { [key: string]: SqlStorageValue; payload: string }
type IdRow = { [key: string]: SqlStorageValue; id: string }
type CountRow = { [key: string]: SqlStorageValue; value: number }

export const maxWorkspaceCheckAttempts = 3
export const maxWorkspaceRepairAttempts = 2
export const maxWorkspaceAutomaticRepairs = 3

export type WorkspaceRepairSource = "manual" | "automatic"

export const automaticRepairIdempotencyKey = (runId: string) =>
  `${runId}:automatic-repair`

export class WorkspaceRepairLimitReached extends Error {
  readonly used: number
  readonly limit: number

  constructor(used: number, limit: number) {
    super(
      `Automatic repair reached its ${limit}-turn limit for this Workspace. Send a message or start a repair manually to continue.`
    )
    this.name = "WorkspaceRepairLimitReached"
    this.used = used
    this.limit = limit
  }
}

const resetStages = (run: WorkspaceCheckRun) =>
  run.stages.map(
    (stage) =>
      new WorkspaceCheckStage({
        name: stage.name,
        status: "queued",
        detail: "Waiting",
        durationMs: null,
      })
  )

export class WorkspaceChecks {
  readonly #storage: WorkspaceStorage

  constructor(storage: WorkspaceStorage) {
    this.#storage = storage
  }

  initialize() {
    this.#storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS app_workspace_check_run (id TEXT PRIMARY KEY NOT NULL, commit_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, updated_at INTEGER NOT NULL, payload TEXT NOT NULL)"
    )
    this.#storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS app_workspace_check_callback (id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL, created_at INTEGER NOT NULL)"
    )
    this.#storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS app_workspace_check_action (id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL)"
    )
    this.#storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS app_workspace_repair_budget (sequence INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, reference TEXT NOT NULL, created_at INTEGER NOT NULL)"
    )
  }

  create(run: WorkspaceCheckRun) {
    this.#storage.sql.exec(
      "INSERT OR IGNORE INTO app_workspace_check_run (id, commit_id, kind, status, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?)",
      run.id,
      run.commit,
      run.kind,
      run.status,
      run.updatedAt,
      JSON.stringify(run)
    )
    return this.get(run.id)
  }

  apply(update: WorkspaceCheckUpdate) {
    const duplicate = this.#storage.sql
      .exec<IdRow>(
        "SELECT id FROM app_workspace_check_callback WHERE id = ?",
        update.callbackId
      )
      .toArray()[0]
    if (duplicate) return false

    const previous = this.get(update.run.id)
    const run =
      previous?.repairNotice && update.run.repairNotice === undefined
        ? new WorkspaceCheckRun({
            ...update.run,
            repairNotice: previous.repairNotice,
          })
        : update.run
    this.#save(run)
    this.#storage.sql.exec(
      "INSERT INTO app_workspace_check_callback (id, run_id, created_at) VALUES (?, ?, ?)",
      update.callbackId,
      run.id,
      Date.now()
    )
    if (run.kind === "checkpoint" && run.status === "passed") {
      this.resetAutomaticRepairs(`passed:${run.id}:${run.attempt}`)
    }
    return true
  }

  get(runId: string) {
    const row = this.#storage.sql
      .exec<CheckRow>(
        "SELECT payload FROM app_workspace_check_run WHERE id = ?",
        runId
      )
      .toArray()[0]
    return row ? decodeWorkspaceCheckRun(JSON.parse(row.payload)) : null
  }

  list() {
    return this.#storage.sql
      .exec<CheckRow>(
        "SELECT payload FROM app_workspace_check_run ORDER BY updated_at DESC"
      )
      .toArray()
      .map((row) => decodeWorkspaceCheckRun(JSON.parse(row.payload)))
  }

  retry(runId: string, idempotencyKey: string) {
    const actionId = `retry:${idempotencyKey}`
    const existing = this.#storage.sql
      .exec<IdRow>(
        "SELECT id FROM app_workspace_check_action WHERE id = ?",
        actionId
      )
      .toArray()[0]
    const run = this.#required(runId)
    if (existing) return run
    if (run.attempt >= maxWorkspaceCheckAttempts) {
      throw new Error(
        `This Check reached its ${maxWorkspaceCheckAttempts}-attempt limit`
      )
    }

    const now = Date.now()
    const retried = new WorkspaceCheckRun({
      ...run,
      status: "queued",
      attempt: run.attempt + 1,
      maxAttempts: maxWorkspaceCheckAttempts,
      repairStatus: run.repairOnFailure ? "available" : "disabled",
      repairNotice: undefined,
      previewUrl: null,
      stages: resetStages(run),
      diagnostics: [],
      evidence: [],
      updatedAt: now,
    })
    this.#save(retried)
    this.#recordAction(actionId, runId, "retry", now)
    return retried
  }

  requestRepair(
    runId: string,
    idempotencyKey: string,
    source: WorkspaceRepairSource = "manual"
  ) {
    const actionId = `repair:${idempotencyKey}`
    const existing = this.#storage.sql
      .exec<IdRow>(
        "SELECT id FROM app_workspace_check_action WHERE id = ?",
        actionId
      )
      .toArray()[0]
    const run = this.#required(runId)
    if (existing) return run
    if (run.status !== "failed") {
      throw new Error("Only a failed Check can start a repair turn")
    }
    const repairAttempt = this.#actionCount(runId, "repair") + 1
    if (repairAttempt > maxWorkspaceRepairAttempts) {
      throw new Error(
        `This Check reached its ${maxWorkspaceRepairAttempts}-repair limit`
      )
    }
    if (source === "automatic") {
      const used = this.automaticRepairsUsed()
      if (used >= maxWorkspaceAutomaticRepairs) {
        throw new WorkspaceRepairLimitReached(
          used,
          maxWorkspaceAutomaticRepairs
        )
      }
    }

    const requested = new WorkspaceCheckRun({
      ...run,
      repairStatus: "requested",
      repairAttempt,
      maxRepairAttempts: maxWorkspaceRepairAttempts,
      updatedAt: Date.now(),
    })
    this.#save(requested)
    this.#recordAction(actionId, runId, "repair", requested.updatedAt)
    if (source === "automatic") {
      this.#storage.sql.exec(
        "INSERT INTO app_workspace_repair_budget (kind, reference, created_at) VALUES ('repair', ?, ?)",
        actionId,
        requested.updatedAt
      )
    }
    return requested
  }

  takeRepair(runId: string) {
    const run = this.#required(runId)
    const eligible =
      run.status === "failed" &&
      (run.repairOnFailure || run.repairStatus === "requested") &&
      run.repairStatus !== "started"
    if (!eligible) return null

    const started = new WorkspaceCheckRun({
      ...run,
      repairStatus: "started",
      updatedAt: Date.now(),
    })
    this.#save(started)
    return started
  }

  recordRepairNotice(runId: string, notice: string) {
    const run = this.#required(runId)
    const noted = new WorkspaceCheckRun({
      ...run,
      repairStatus: run.repairStatus === "started" ? "started" : "available",
      repairNotice: notice,
      updatedAt: Date.now(),
    })
    this.#save(noted)
    return noted
  }

  addEvidence(runId: string, evidence: ReadonlyArray<WorkspaceCheckEvidence>) {
    const run = this.#required(runId)
    const updated = new WorkspaceCheckRun({
      ...run,
      evidence: [...run.evidence, ...evidence],
      updatedAt: Date.now(),
    })
    this.#save(updated)
    return updated
  }

  automaticRepairsUsed() {
    return (
      this.#storage.sql
        .exec<CountRow>(
          "SELECT COUNT(*) AS value FROM app_workspace_repair_budget WHERE kind = 'repair' AND sequence > COALESCE((SELECT MAX(sequence) FROM app_workspace_repair_budget WHERE kind = 'reset'), 0)"
        )
        .toArray()[0]?.value ?? 0
    )
  }

  resetAutomaticRepairs(reference: string) {
    this.#storage.sql.exec(
      "INSERT INTO app_workspace_repair_budget (kind, reference, created_at) VALUES ('reset', ?, ?)",
      reference,
      Date.now()
    )
  }

  latestPassingCheckpoint(commit: string) {
    return (
      this.list().find(
        (run) =>
          run.kind === "checkpoint" &&
          run.commit === commit &&
          run.status === "passed"
      ) ?? null
    )
  }

  #required(runId: string) {
    const run = this.get(runId)
    if (!run) throw new Error("Check run not found")
    return run
  }

  #save(run: WorkspaceCheckRun) {
    this.#storage.sql.exec(
      "INSERT INTO app_workspace_check_run (id, commit_id, kind, status, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET commit_id = excluded.commit_id, kind = excluded.kind, status = excluded.status, updated_at = excluded.updated_at, payload = excluded.payload",
      run.id,
      run.commit,
      run.kind,
      run.status,
      run.updatedAt,
      JSON.stringify(run)
    )
  }

  #recordAction(id: string, runId: string, kind: string, createdAt: number) {
    this.#storage.sql.exec(
      "INSERT INTO app_workspace_check_action (id, run_id, kind, created_at) VALUES (?, ?, ?, ?)",
      id,
      runId,
      kind,
      createdAt
    )
  }

  #actionCount(runId: string, kind: string) {
    return (
      this.#storage.sql
        .exec<CountRow>(
          "SELECT COUNT(*) AS value FROM app_workspace_check_action WHERE run_id = ? AND kind = ?",
          runId,
          kind
        )
        .toArray()[0]?.value ?? 0
    )
  }
}

export const checkStage = (
  name: WorkspaceCheckStageName,
  status: WorkspaceCheckStage["status"],
  detail: string,
  durationMs: number | null = null
) => new WorkspaceCheckStage({ name, status, detail, durationMs })
