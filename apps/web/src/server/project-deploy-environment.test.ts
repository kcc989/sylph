import { describe, expect, test } from "bun:test"

import {
  projectDeployEnvironment,
  projectSlugSql,
  type ProjectSlugDatabase,
  readProjectSlug,
} from "./project-deploy-environment"

describe("project deploy environment", () => {
  test("passes the Project slug, checkpoint, and deployment kind", () => {
    expect(
      projectDeployEnvironment({
        slug: "weather-desk",
        checkpoint: "abc123",
        deployment: "preview",
      })
    ).toEqual({
      SYLPH_PROJECT: "weather-desk",
      SYLPH_CHECKPOINT: "abc123",
      SYLPH_DEPLOYMENT: "preview",
    })
  })

  test("reads the slug through a prepared statement", async () => {
    const calls: Array<unknown> = []
    const database: ProjectSlugDatabase = {
      prepare: (sql) => {
        calls.push(sql)
        return {
          bind: (...values) => {
            calls.push(values)
            return { first: async () => ({ slug: "weather-desk" }) }
          },
        }
      },
    }
    const slug = await readProjectSlug(database, "project-1")
    expect(slug).toBe("weather-desk")
    expect(calls).toEqual([projectSlugSql, ["project-1"]])
  })

  test("fails when the Project row is missing", async () => {
    const database: ProjectSlugDatabase = {
      prepare: () => ({ bind: () => ({ first: async () => null }) }),
    }
    await expect(readProjectSlug(database, "project-1")).rejects.toThrow(
      "no longer exists"
    )
  })
})
