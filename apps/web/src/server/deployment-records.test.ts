import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"

import {
  deploymentFailedSql,
  deploymentRunningSql,
  deploymentSucceededSql,
  deploymentWithoutHooksSucceededSql,
  deploymentWorkflowAlreadyStarted,
  productionUrl,
} from "./deployment-records"

const database = () => {
  const database = new Database(":memory:")
  database.exec(
    "CREATE TABLE deployment (id TEXT PRIMARY KEY, status TEXT, production_url TEXT, failure_details TEXT, started_at INTEGER, completed_at INTEGER, updated_at INTEGER, review_json TEXT, recovery_json TEXT, verification_json TEXT, recovery_deployment_id TEXT, restore_json TEXT, managed_release INTEGER DEFAULT 0)"
  )
  database.exec(
    "INSERT INTO deployment (id, status) VALUES ('deployment-1', 'queued')"
  )
  return database
}

describe("Deployment records", () => {
  test("records a successful production Deployment", () => {
    const store = database()
    store.query(deploymentRunningSql).run("deployment-1")
    store.exec(
      "UPDATE deployment SET review_json = '{}', recovery_json = '{}', verification_json = '{}'"
    )
    store
      .query(deploymentSucceededSql)
      .run("https://project.example", "deployment-1")

    expect(
      store
        .query(
          "SELECT status, production_url AS productionUrl, failure_details AS failureDetails FROM deployment WHERE id = ?"
        )
        .get("deployment-1")
    ).toEqual({
      status: "succeeded",
      productionUrl: "https://project.example",
      failureDetails: null,
    })
  })

  test("keeps production failure details", () => {
    const store = database()
    store.query(deploymentFailedSql).run("Build failed", "deployment-1")

    expect(
      store
        .query(
          "SELECT status, failure_details AS failureDetails FROM deployment WHERE id = ?"
        )
        .get("deployment-1")
    ).toEqual({ status: "failed", failureDetails: "Build failed" })
  })

  test("reads the production URL contract", () => {
    expect(
      productionUrl("complete\nSYLPH_PRODUCTION_URL=https://project.example\n")
    ).toBe("https://project.example")
    expect(productionUrl("complete")).toBeNull()
  })

  test("recognizes an idempotent Workflow start", () => {
    expect(
      deploymentWorkflowAlreadyStarted(
        new Error("(instance.already_exists) Instance already exists")
      )
    ).toBeTrue()
  })
})

test("a URL alone cannot complete a production release", () => {
  const store = database()
  store.query(deploymentRunningSql).run("deployment-1")
  expect(
    store
      .query(deploymentSucceededSql)
      .run("https://example.com", "deployment-1").changes
  ).toBe(0)
})

test("a confirmed deployment without managed hooks can complete without recovery receipts", () => {
  const store = database()
  store.query(deploymentRunningSql).run("deployment-1")
  expect(
    store
      .query(deploymentWithoutHooksSucceededSql)
      .run("https://example.com", "deployment-1").changes
  ).toBe(1)
  store.close()
})

test("the deployment path without hooks cannot bypass managed recovery or a requested restore", () => {
  const store = database()
  store.query(deploymentRunningSql).run("deployment-1")
  store.exec("UPDATE deployment SET managed_release = 1")
  expect(
    store
      .query(deploymentWithoutHooksSucceededSql)
      .run("https://example.com", "deployment-1").changes
  ).toBe(0)
  store.exec(
    "UPDATE deployment SET managed_release = 0, recovery_deployment_id = 'restore'"
  )
  expect(
    store
      .query(deploymentWithoutHooksSucceededSql)
      .run("https://example.com", "deployment-1").changes
  ).toBe(0)
  store.close()
})
