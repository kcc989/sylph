import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"

import {
  type AccountProvisioningRow,
  accountProvisioningQuery,
  getAccountProvisioningBindings,
} from "./auth-access"

const createFixture = (claimed: boolean) => {
  const sqlite = new Database(":memory:")
  sqlite.run(`CREATE TABLE installation (
    id TEXT PRIMARY KEY,
    organization_id TEXT,
    claimed_by_user_id TEXT
  )`)
  sqlite.run(`CREATE TABLE invitation (
    id TEXT PRIMARY KEY,
    organization_id TEXT NOT NULL,
    email TEXT NOT NULL,
    status TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )`)
  sqlite
    .query(
      "INSERT INTO installation (id, organization_id, claimed_by_user_id) VALUES (?, ?, ?)"
    )
    .run(
      "default",
      claimed ? "installation-organization" : null,
      claimed ? "owner" : null
    )

  return sqlite
}

const now = new Date("2026-08-27T12:00:00Z")

const canProvisionAccount = (sqlite: Database, email: string) =>
  sqlite
    .query<AccountProvisioningRow, [string, number, string]>(
      accountProvisioningQuery
    )
    .get(...getAccountProvisioningBindings(email, now))?.allowed === 1

describe("Installation account provisioning", () => {
  test("allows the first operator before the Installation is claimed", () => {
    const sqlite = createFixture(false)

    expect(canProvisionAccount(sqlite, "operator@example.com")).toBe(true)

    sqlite.close()
  })

  test("rejects an uninvited email after the Installation is claimed", () => {
    const sqlite = createFixture(true)

    expect(canProvisionAccount(sqlite, "stranger@example.com")).toBe(false)

    sqlite.close()
  })

  test("allows a matching live pending Invitation", () => {
    const sqlite = createFixture(true)
    sqlite
      .query(
        "INSERT INTO invitation (id, organization_id, email, status, expires_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        "invitation",
        "installation-organization",
        "Invited@Example.com",
        "pending",
        Math.floor(now.getTime() / 1000) + 60
      )

    expect(canProvisionAccount(sqlite, " invited@example.com ")).toBe(true)

    sqlite.close()
  })

  test("rejects expired, accepted, and unrelated Invitations", () => {
    const sqlite = createFixture(true)
    const insertInvitation = sqlite.query(
      "INSERT INTO invitation (id, organization_id, email, status, expires_at) VALUES (?, ?, ?, ?, ?)"
    )
    insertInvitation.run(
      "expired",
      "installation-organization",
      "expired@example.com",
      "pending",
      Math.floor(now.getTime() / 1000) - 1
    )
    insertInvitation.run(
      "accepted",
      "installation-organization",
      "accepted@example.com",
      "accepted",
      Math.floor(now.getTime() / 1000) + 60
    )
    insertInvitation.run(
      "unrelated",
      "another-organization",
      "unrelated@example.com",
      "pending",
      Math.floor(now.getTime() / 1000) + 60
    )

    expect(
      ["expired", "accepted", "unrelated"].map((name) =>
        canProvisionAccount(sqlite, `${name}@example.com`)
      )
    ).toEqual([false, false, false])

    sqlite.close()
  })
})
