import {
  decodeWorkspaceCheckRun,
  WorkspaceCheckRun,
  WorkspaceCheckStage,
  type WorkspaceCheckStageName,
  type WorkspaceCheckUpdate,
} from "@workspace/domain"

import type { WorkspaceStorage } from "./workspace-filesystem"

type CheckRow = { [key: string]: SqlStorageValue; payload: string }
type IdRow = { [key: string]: SqlStorageValue; id: string }

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

    this.#save(update.run)
    this.#storage.sql.exec(
      "INSERT INTO app_workspace_check_callback (id, run_id, created_at) VALUES (?, ?, ?)",
      update.callbackId,
      update.run.id,
      Date.now()
    )
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

    const now = Date.now()
    const retried = new WorkspaceCheckRun({
      ...run,
      status: "queued",
      attempt: run.attempt + 1,
      repairStatus: run.repairOnFailure ? "available" : "disabled",
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

  requestRepair(runId: string, idempotencyKey: string) {
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

    const requested = new WorkspaceCheckRun({
      ...run,
      repairStatus: "requested",
      updatedAt: Date.now(),
    })
    this.#save(requested)
    this.#recordAction(actionId, runId, "repair", requested.updatedAt)
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
}

export const checkStage = (
  name: WorkspaceCheckStageName,
  status: WorkspaceCheckStage["status"],
  detail: string,
  durationMs: number | null = null
) => new WorkspaceCheckStage({ name, status, detail, durationMs })
