import { expect, test } from "bun:test"
import { Miniflare } from "miniflare"
import { readFileSync } from "node:fs"
import { drizzle } from "drizzle-orm/d1"
import { schema } from "@workspace/db"
import { requireProject } from "./organization-access"
import {
  readOperations,
  refreshOperations,
  refreshScheduledOperations,
  repairWorkspaceSql,
  repairIssueSql,
  linkRepairSql,
  repairPromptSql,
} from "./project-operations"

test("D1 operations retain incidents across requests and reject non-members", async () => {
  const runtime = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('fixture') } }",
    compatibilityDate: "2026-08-01",
    d1Databases: ["DB"],
  })
  try {
    const db = await runtime.getD1Database("DB")
    for (const name of ["0001_initial.sql"]) {
      const migration = readFileSync(
        new URL(`../../../../packages/db/migrations/${name}`, import.meta.url),
        "utf8"
      )
      for (const statement of migration
        .split(";")
        .map((sql) => sql.trim())
        .filter(Boolean))
        await db.prepare(statement).run()
    }
    const fixture = [
      "INSERT INTO user(id, name, email) VALUES ('member', 'Member', 'member@example.com'), ('stranger', 'Stranger', 'stranger@example.com')",
      "INSERT INTO organization(id, name, slug) VALUES ('organization', 'Organization', 'organization')",
      "INSERT INTO member(id, organization_id, user_id, role) VALUES ('membership', 'organization', 'member', 'member')",
      "INSERT INTO project(id, organization_id, owner_user_id, name, slug, artifact_repo_id, artifact_repo, artifact_remote) VALUES ('project', 'organization', 'member', 'Project', 'project', 'repo', 'repo', 'https://example.com/repo')",
    ]
    for (const statement of fixture) await db.prepare(statement).run()
    const commit = "a".repeat(40)
    const identity = {
      accountId: "account",
      scriptName: "worker",
      deploymentId: "cf-deployment",
      versionId: "version",
    }
    await db
      .prepare(
        "INSERT INTO deployment(id, project_id, \"commit\", status, actor_user_id, completed_at, identity_json, production_url) VALUES ('deployment', 'project', ?, 'failed', 'member', 100, ?, 'https://production.example.com')"
      )
      .bind(commit, JSON.stringify([identity]))
      .run()
    const database = drizzle(db, { schema })
    expect((await requireProject(database, "project", "member")).id).toBe(
      "project"
    )
    await expect(
      requireProject(database, "project", "stranger")
    ).rejects.toThrow("cannot access")
    await expect(requireProject(database, "project", "")).rejects.toThrow(
      "cannot access"
    )
    let calls = 0
    const request: typeof fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        calls += 1
        return String(input).endsWith("/deployments")
          ? Response.json({
              success: true,
              result: {
                deployments: [
                  {
                    id: identity.deploymentId,
                    created_on: "2026-09-01T00:00:00Z",
                    versions: [{ version_id: "version", percentage: 100 }],
                  },
                ],
              },
            })
          : Response.json({
              success: true,
              result: {
                run: { status: "COMPLETED" },
                events: {
                  events: [
                    {
                      timestamp: 1500000,
                      $metadata: {
                        id: "event",
                        type: "cf-worker-event",
                        statusCode: 500,
                      },
                      $workers: {
                        requestId: "request",
                        scriptName: "worker",
                        scriptVersion: { id: "version" },
                        outcome: "exception",
                        wallTimeMs: 2300,
                      },
                    },
                  ],
                },
              },
            })
      },
      { preconnect: fetch.preconnect }
    )
    const credentials = { accountId: "account", token: "fixture" }
    const scheduled = await refreshScheduledOperations(
      db,
      credentials,
      2000000,
      request
    )
    expect(scheduled).toEqual({ collected: 1, failed: 0 })
    const first = await readOperations(db, "project")
    expect(first.observation?.status).toBe("degraded")
    expect(first.incidents).toHaveLength(3)
    expect(
      first.incidents.some((incident) => incident.kind === "release")
    ).toBe(true)
    expect(first.observation?.deploymentId).toBe("deployment")
    expect(first.observation?.detail).toContain("failed after publication")
    await refreshOperations(db, credentials, "project", 2000001, request)
    expect(calls).toBe(3)
    expect(
      await refreshScheduledOperations(db, credentials, 2000001, request)
    ).toEqual({ collected: 0, failed: 0 })
    expect(calls).toBe(3)
    const incident = first.incidents[0]
    await db.batch([
      db
        .prepare(repairWorkspaceSql)
        .bind(
          "workspace",
          "project",
          "organization",
          "member",
          "repair:incident",
          "Repair",
          "repair-branch",
          "repo",
          "fork",
          commit
        ),
      db
        .prepare(repairIssueSql)
        .bind(
          "issue",
          "organization",
          "project",
          "Repair",
          "diagnostics",
          "member",
          "project",
          incident.id
        ),
      db
        .prepare(linkRepairSql)
        .bind("project", "repair:incident", "issue", incident.id, "project"),
      db
        .prepare(repairPromptSql)
        .bind(
          "prompt",
          JSON.stringify({ workspaceId: "workspace", text: "diagnostics" }),
          2000000,
          "project",
          "repair:incident"
        ),
    ])
    expect(
      (await readOperations(db, "project")).incidents.find(
        (item) => item.id === incident.id
      )?.workspace_id
    ).toBe("workspace")
    expect((await readOperations(db, "other-project")).incidents).toEqual([])
    await db.prepare("DELETE FROM member WHERE id='membership'").run()
    await expect(requireProject(database, "project", "member")).rejects.toThrow(
      "cannot access"
    )
  } finally {
    await runtime.dispose()
  }
}, 30000)
