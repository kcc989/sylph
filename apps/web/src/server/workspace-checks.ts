import type { WorkspacePreviewExpiry } from "@workspace/domain/checks"
import {
  GitCommitId,
  InvalidRequest,
  PreconditionFailed,
  type WorkspaceCheckEvidence,
  type WorkspaceCheckKind,
  WorkspaceCheckRun,
  WorkspaceCheckCompletion,
  WorkspaceCheckStage,
  type WorkspaceCheckStageName,
  type WorkspaceCheckUpdate,
  WorkspaceId,
} from "@workspace/domain"

import type { WorkspaceStorage } from "./workspace-filesystem"
import { Schema } from "effect"
import { checkCompletion } from "./workspace-check-notification"

const decodeWorkspaceCheckRun = Schema.decodeUnknownSync(WorkspaceCheckRun)

type CompletionRow = {
  [key: string]: SqlStorageValue
  payload: string
  prepared: number
}

type CheckRow = { [key: string]: SqlStorageValue; payload: string }
type IdRow = { [key: string]: SqlStorageValue; id: string }
type CountRow = { [key: string]: SqlStorageValue; value: number }

export const maxWorkspaceCheckAttempts = 3
export const maxWorkspaceCheckContinuations = 3

const checkpointStages: ReadonlyArray<WorkspaceCheckStageName> = [
  "install",
  "typecheck",
  "lint",
  "test",
  "build",
  "preview",
  "browser",
]
const productionStages: ReadonlyArray<WorkspaceCheckStageName> = [
  "install",
  "build",
  "release-review",
  "release-prepare",
  "data-restore",
  "production",
  "browser",
  "production-journey",
  "release-resume",
]

export const checkStages = (kind: WorkspaceCheckKind) =>
  kind === "dependencies"
    ? (["install"] as const)
    : kind === "production"
      ? productionStages
      : checkpointStages

export const checkStage = (
  name: WorkspaceCheckStageName,
  status: WorkspaceCheckStage["status"],
  detail: string,
  durationMs: number | null = null
) => new WorkspaceCheckStage({ name, status, detail, durationMs })

export const newCheckRun = (input: {
  id: string
  workspaceId: string
  checkpointId: string | null
  commit: string
  kind: WorkspaceCheckKind
  attempt: number
  createdAt: number
}) =>
  new WorkspaceCheckRun({
    id: input.id,
    workspaceId: WorkspaceId.make(input.workspaceId),
    checkpointId: input.checkpointId,
    commit: GitCommitId.make(input.commit),
    kind: input.kind,
    status: "queued",
    attempt: input.attempt,
    maxAttempts: maxWorkspaceCheckAttempts,
    previewUrl: null,
    stages: checkStages(input.kind).map((name) =>
      checkStage(name, "queued", "Waiting")
    ),
    diagnostics: [],
    evidence: [],
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  })

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
  #delivery: Promise<void> | null = null

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
      "CREATE TABLE IF NOT EXISTS app_workspace_check_completion (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0, prepared INTEGER NOT NULL DEFAULT 0)"
    )
    const columns = this.#storage.sql
      .exec<{ name: string }>(
        "PRAGMA table_info(app_workspace_check_completion)"
      )
      .toArray()
    if (!columns.some((column) => column.name === "prepared")) {
      this.#storage.sql.exec(
        "ALTER TABLE app_workspace_check_completion ADD COLUMN prepared INTEGER NOT NULL DEFAULT 0"
      )
      this.#storage.sql.exec(
        "UPDATE app_workspace_check_completion SET prepared = 1"
      )
    }
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
    const apply = () => {
      const duplicate = this.#storage.sql
        .exec<IdRow>(
          "SELECT id FROM app_workspace_check_callback WHERE id = ?",
          update.callbackId
        )
        .toArray()[0]
      if (duplicate) return false
      const previous = this.get(update.run.id)
      const run = update.run
      if (
        previous &&
        (previous.attempt > run.attempt ||
          (previous.attempt === run.attempt &&
            (previous.status === "passed" || previous.status === "failed")))
      )
        return false
      this.#save(run)
      const completion = checkCompletion(run, 0, maxWorkspaceCheckContinuations)
      if (completion) {
        this.#storage.sql.exec(
          "INSERT OR IGNORE INTO app_workspace_check_completion (id, payload) VALUES (?, ?)",
          completion.id,
          JSON.stringify(completion)
        )
      }
      this.#storage.sql.exec(
        "INSERT INTO app_workspace_check_callback (id, run_id, created_at) VALUES (?, ?, ?)",
        update.callbackId,
        run.id,
        Date.now()
      )
      if (run.kind === "checkpoint" && run.status === "passed")
        this.resetCheckContinuations(`passed:${run.id}:${run.attempt}`)
      return true
    }
    return this.#storage.transactionSync
      ? this.#storage.transactionSync(apply)
      : apply()
  }

  hasPendingCompletions() {
    return (
      this.#storage.sql
        .exec<IdRow>(
          "SELECT id FROM app_workspace_check_completion WHERE delivered = 0 LIMIT 1"
        )
        .toArray().length > 0
    )
  }

  deliverCompletions(
    send: (completion: WorkspaceCheckCompletion) => Promise<void>,
    eligible: (
      completion: WorkspaceCheckCompletion
    ) => Promise<boolean> = async () => true
  ) {
    if (this.#delivery) return this.#delivery
    this.#delivery = this.#deliverCompletions(send, eligible).finally(() => {
      this.#delivery = null
    })
    return this.#delivery
  }

  async #deliverCompletions(
    send: (completion: WorkspaceCheckCompletion) => Promise<void>,
    eligible: (completion: WorkspaceCheckCompletion) => Promise<boolean>
  ) {
    const rows = this.#storage.sql
      .exec<CompletionRow>(
        "SELECT payload, prepared FROM app_workspace_check_completion WHERE delivered = 0 ORDER BY rowid"
      )
      .toArray()
    for (const row of rows) {
      const completion = Schema.decodeUnknownSync(WorkspaceCheckCompletion)(
        JSON.parse(row.payload)
      )
      if (await eligible(completion)) {
        const prepared = row.prepared
          ? completion
          : this.#prepareCompletion(completion)
        await send(prepared)
      }
      this.#storage.sql.exec(
        "UPDATE app_workspace_check_completion SET delivered = 1 WHERE id = ?",
        completion.id
      )
    }
  }

  #prepareCompletion(completion: WorkspaceCheckCompletion) {
    const prepare = () => {
      const run = this.#required(completion.runId)
      const prepared =
        checkCompletion(
          run,
          this.checkContinuationsUsed(),
          maxWorkspaceCheckContinuations
        ) ?? completion
      if (prepared.resume)
        this.#storage.sql.exec(
          "INSERT INTO app_workspace_repair_budget (kind, reference, created_at) VALUES ('repair', ?, ?)",
          prepared.id,
          Date.now()
        )
      this.#storage.sql.exec(
        "UPDATE app_workspace_check_completion SET payload = ?, prepared = 1 WHERE id = ?",
        JSON.stringify(prepared),
        prepared.id
      )
      return prepared
    }
    return this.#storage.transactionSync
      ? this.#storage.transactionSync(prepare)
      : prepare()
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

  expirePreview(input: typeof WorkspacePreviewExpiry.Type) {
    const expire = () => {
      const current = this.get(input.runId)
      if (!current || current.attempt !== input.attempt || !current.previewUrl)
        return null
      const updated = new WorkspaceCheckRun({
        ...current,
        previewUrl: null,
        updatedAt: Date.now(),
      })
      this.#save(updated)
      return updated
    }
    return this.#storage.transactionSync
      ? this.#storage.transactionSync(expire)
      : expire()
  }

  list() {
    return this.#storage.sql
      .exec<CheckRow>(
        "SELECT payload FROM app_workspace_check_run ORDER BY updated_at DESC"
      )
      .toArray()
      .map((row) => decodeWorkspaceCheckRun(JSON.parse(row.payload)))
      .sort((left, right) => right.createdAt - left.createdAt)
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
    if (run.kind === "dependencies") {
      throw new PreconditionFailed({
        message:
          "Dependency repair jobs are retired. Run bun install with the native shell tool, then create a Checkpoint.",
      })
    }
    if (run.attempt >= maxWorkspaceCheckAttempts) {
      throw new PreconditionFailed({
        message: `This Check reached its ${maxWorkspaceCheckAttempts}-attempt limit`,
      })
    }

    const now = Date.now()
    const retried = new WorkspaceCheckRun({
      ...run,
      status: "queued",
      attempt: run.attempt + 1,
      maxAttempts: maxWorkspaceCheckAttempts,
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

  checkContinuationsUsed() {
    return (
      this.#storage.sql
        .exec<CountRow>(
          "SELECT COUNT(*) AS value FROM app_workspace_repair_budget WHERE kind = 'repair' AND sequence > COALESCE((SELECT MAX(sequence) FROM app_workspace_repair_budget WHERE kind = 'reset'), 0)"
        )
        .toArray()[0]?.value ?? 0
    )
  }

  resetCheckContinuations(reference: string) {
    this.#storage.sql.exec(
      "INSERT INTO app_workspace_repair_budget (kind, reference, created_at) SELECT 'reset', ?, ? WHERE NOT EXISTS (SELECT 1 FROM app_workspace_repair_budget WHERE kind = 'reset' AND reference = ?)",
      reference,
      Date.now(),
      reference
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
    if (!run) throw new InvalidRequest({ message: "Check run not found" })
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
