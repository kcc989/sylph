import { expect, test } from "bun:test"
import { Schema } from "effect"
import { DeploymentRecoveryPoint } from "@workspace/domain"
import { StoredProjectResource } from "@workspace/domain/project-resources"
import { validateRecoveryInventory } from "./release-safety"

const resource = (
  kind: typeof StoredProjectResource.Type.kind,
  id: string,
  changes: Partial<typeof StoredProjectResource.Type> = {}
) =>
  Schema.decodeUnknownSync(StoredProjectResource)({
    account_id: "account",
    project_id: "project",
    scope: "production",
    kind,
    name: `sylph-${id}`,
    resource_id: id,
    generation: null,
    state: "active",
    ...changes,
  })
const point = (resources: Array<{ kind: string; id: string }>) =>
  Schema.decodeUnknownSync(DeploymentRecoveryPoint)({
    deploymentId: "release",
    projectId: "project",
    commit: "a".repeat(40),
    baseCommit: null,
    capturedAt: 1000,
    expiresAt: 2000,
    writesPaused: true,
    inventoryComplete: true,
    resources: resources.map((item) => ({
      ...item,
      backupRef: "backup",
      restoreVerifiedAt: 900,
    })),
  })

test("recovery inventory covers every existing owned storage boundary and excludes control state", () => {
  const inventory = [
    resource("worker", "worker"),
    resource("domain", "domain"),
    resource("d1", "db"),
    resource("d1", "control", { purpose: "recovery_control" }),
    resource("r2", "bucket"),
    resource("kv", "kv"),
    resource("durable_object", "namespace"),
    resource("queue", "queue"),
    resource("workflow", "workflow"),
  ]
  const receipt = point([
    { kind: "database", id: "db" },
    { kind: "object-storage", id: "bucket" },
    { kind: "kv", id: "kv" },
    { kind: "durable-object", id: "namespace" },
    { kind: "other", id: "queue" },
    { kind: "other", id: "workflow" },
    { kind: "secret", id: "BETTER_AUTH_SECRET" },
  ])
  expect(validateRecoveryInventory(receipt, inventory)).toBe(receipt)
  for (const entry of receipt.resources.filter(
    (entry) => entry.kind !== "secret"
  )) {
    expect(() =>
      validateRecoveryInventory(
        point(receipt.resources.filter((item) => item.id !== entry.id)),
        inventory
      )
    ).toThrow("exactly the owned")
  }
  expect(() =>
    validateRecoveryInventory(
      point([...receipt.resources, { kind: "database", id: "control" }]),
      inventory
    )
  ).toThrow("exactly the owned")
  expect(() =>
    validateRecoveryInventory(
      point([...receipt.resources, { kind: "database", id: "foreign" }]),
      inventory
    )
  ).toThrow("exactly the owned")
})

test("retired retained data still requires backup; absent reserved and deleted resources do not", () => {
  const inventory = [
    resource("d1", "retained", { state: "retired" }),
    resource("d1", "future", { state: "reserved", resource_id: null }),
    resource("d1", "deleted", { state: "deleted" }),
  ]
  expect(() => validateRecoveryInventory(point([]), inventory)).toThrow(
    "exactly the owned"
  )
  expect(() =>
    validateRecoveryInventory(
      point([{ kind: "database", id: "retained" }]),
      inventory
    )
  ).not.toThrow()
})

test("unknown existing provider identity and foreign scope are rejected", () => {
  expect(() =>
    validateRecoveryInventory(point([]), [
      resource("d1", "unknown", { resource_id: null }),
    ])
  ).toThrow("provider identity")
  expect(() =>
    validateRecoveryInventory(point([]), [
      resource("d1", "other", { project_id: "other" }),
    ])
  ).toThrow("different Project")
  expect(() =>
    validateRecoveryInventory(point([]), [
      resource("d1", "preview", { scope: "preview:run" }),
    ])
  ).toThrow("different Project")
})
