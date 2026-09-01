import { describe, expect, test } from "bun:test"

import { serializeInstalledSkill, storedSkill } from "./installed-skills"

describe("installed Skill storage", () => {
  test("restores invocation metadata and files", () => {
    const skill = storedSkill({
      id: "one",
      catalog_id: "owner/repo/review",
      source: "owner/repo",
      source_url: "https://skills.sh/owner/repo/review",
      source_hash: "hash",
      scope: "installation",
      project_id: null,
      name: "review",
      description: "Review code",
      disable_model_invocation: 1,
      user_invokable: 0,
      files: JSON.stringify([{ path: "SKILL.md", content: "Review" }]),
      created_at: 10,
    })

    expect(skill.metadata.disableModelInvocation).toBe(true)
    expect(skill.metadata.userInvokable).toBe(false)
    expect(skill.files[0]?.content).toBe("Review")

    const serialized = serializeInstalledSkill(skill)
    expect(Object.getPrototypeOf(serialized)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(serialized.metadata)).toBe(Object.prototype)
    expect(Object.getPrototypeOf(serialized.files[0])).toBe(Object.prototype)
  })
})
