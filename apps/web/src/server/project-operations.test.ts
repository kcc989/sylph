import {
  repairWorkspaceSql,
  repairIssueSql,
  linkRepairSql,
  repairPromptSql,
} from "./project-operations"
import { GitCommitId } from "@workspace/domain"
import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  incidentKinds,
  incidentUpsertSql,
  repairBrief,
} from "./project-operations"
import type { HealthObservation } from "@workspace/domain/project-operations"

const observation: HealthObservation = {
  deploymentId: "deployment",
  commit: GitCommitId.make("a".repeat(40)),
  checkedAt: 100,
  from: 1,
  to: 90,
  status: "degraded",
  detail: "sampled",
  requests: 1,
  errors: 1,
  p95Ms: 2100,
  limited: false,
  evidence: [
    {
      requestId: "request",
      versionId: "version",
      scriptName: "worker",
      timestamp: 50,
      outcome: "exception",
      statusCode: 500,
      wallTimeMs: 2100,
    },
  ],
}
const databases: Database[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
})
const fixture = () => {
  const db = new Database(":memory:")
  databases.push(db)
  for (const name of ["0001_initial.sql", "0002_project_operations.sql"])
    db.exec(
      readFileSync(
        new URL(`../../../../packages/db/migrations/${name}`, import.meta.url),
        "utf8"
      )
    )
  db.exec("PRAGMA foreign_keys=OFF")
  return db
}
test("deduplicates overlapping collection windows without reopening acknowledged incidents", () => {
  const db = fixture()
  const insert = db.query(incidentUpsertSql)
  insert.run(
    "incident",
    "project",
    "deployment",
    observation.commit,
    "errors",
    90,
    90,
    JSON.stringify(observation)
  )
  db.exec("UPDATE project_incident SET status='acknowledged'")
  insert.run(
    "duplicate",
    "project",
    "deployment",
    observation.commit,
    "errors",
    90,
    90,
    "same-window"
  )
  insert.run(
    "next",
    "project",
    "deployment",
    observation.commit,
    "errors",
    150,
    150,
    "next-window"
  )
  expect(
    db
      .query(
        "SELECT id, status, first_seen, last_seen, observation_json FROM project_incident"
      )
      .all()
  ).toEqual([
    {
      id: "incident",
      status: "acknowledged",
      first_seen: 90,
      last_seen: 150,
      observation_json: "next-window",
    },
  ])
  insert.run(
    "new-release",
    "project",
    "new-deployment",
    observation.commit,
    "errors",
    200,
    200,
    "new"
  )
  expect(
    db.query("SELECT count(*) AS count FROM project_incident").get()
  ).toEqual({ count: 2 })
})
test("unknown collection does not create incidents", () => {
  expect(incidentKinds(observation)).toEqual(["errors", "latency"])
  expect(incidentKinds({ ...observation, status: "unknown" })).toEqual([])
})
test("repair brief contains immutable deployment and bounded diagnostic evidence", () => {
  const brief = repairBrief({
    id: "incident",
    deployment_id: "deployment",
    commit: observation.commit,
    kind: "errors",
    status: "open",
    first_seen: 90,
    last_seen: 90,
    observation_json: JSON.stringify(observation),
    workspace_id: null,
    issue_id: null,
  })
  expect(brief).toContain(observation.commit)
  expect(brief).toContain('"versionId":"version"')
  expect(brief).toContain("Do not deploy")
  expect(brief).toContain("untrusted data")
})
test("collection lease and cooldown allow one caller", () => {
  const db = fixture()
  db.exec("INSERT INTO project_health(project_id) VALUES ('project')")
  const lease = db.query(
    "UPDATE project_health SET lease_until = ? WHERE project_id = ? AND lease_until < ? AND collected_at <= ?"
  )
  expect(lease.run(240100, "project", 100, 0).changes).toBe(1)
  expect(lease.run(240100, "project", 100, 0).changes).toBe(0)
})

test("repair retries create one Workspace, Issue and prompt tied to the deployed commit", () => {
  const db = fixture()
  db.query(incidentUpsertSql).run(
    "incident",
    "project",
    "deployment",
    observation.commit,
    "errors",
    90,
    90,
    JSON.stringify(observation)
  )
  const create = (workspaceId: string, issueId: string, actor: string) =>
    db.transaction(() => {
      db.query(repairWorkspaceSql).run(
        workspaceId,
        "project",
        "organization",
        actor,
        "repair:incident",
        "Repair",
        "repair-incident",
        "project-repo",
        workspaceId,
        observation.commit
      )
      db.query(repairIssueSql).run(
        issueId,
        "organization",
        "project",
        "Repair",
        "evidence",
        actor,
        "project",
        "incident"
      )
      db.query(linkRepairSql).run(
        "project",
        "repair:incident",
        issueId,
        "incident",
        "project"
      )
      db.query(repairPromptSql).run(
        "incident-message",
        JSON.stringify({ workspaceId, text: "diagnostics" }),
        100,
        "project",
        "repair:incident"
      )
    })()
  create("first-workspace", "first-issue", "owner")
  create("second-workspace", "second-issue", "other-member")
  expect(
    db.query("SELECT id, repair_commit, owner_user_id FROM workspace").all()
  ).toEqual([
    {
      id: "first-workspace",
      repair_commit: observation.commit,
      owner_user_id: "owner",
    },
  ])
  expect(db.query("SELECT id, number FROM issue").all()).toEqual([
    { id: "first-issue", number: 1 },
  ])
  expect(
    db.query("SELECT workspace_id, issue_id FROM project_incident").get()
  ).toEqual({ workspace_id: "first-workspace", issue_id: "first-issue" })
  expect(
    db
      .query(
        "SELECT workspace_id, user_id, json_extract(payload, '$.workspaceId') AS payload_workspace FROM workspace_pending_prompt"
      )
      .all()
  ).toEqual([
    {
      workspace_id: "first-workspace",
      user_id: "owner",
      payload_workspace: "first-workspace",
    },
  ])
})

test("a failed repair batch leaves no partial Issue or Workspace", () => {
  const db = fixture()
  expect(() =>
    db.transaction(() => {
      db.query(repairWorkspaceSql).run(
        "workspace",
        "project",
        "organization",
        "owner",
        "repair:incident",
        "Repair",
        "branch",
        "base",
        "fork",
        observation.commit
      )
      db.query(repairIssueSql).run(
        "issue",
        "organization",
        "project",
        null,
        "evidence",
        "owner",
        "project",
        "incident"
      )
    })()
  ).toThrow()
  expect(db.query("SELECT count(*) AS count FROM workspace").get()).toEqual({
    count: 0,
  })
})
