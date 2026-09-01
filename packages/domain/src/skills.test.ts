import { describe, expect, test } from "bun:test"

import {
  InstalledSkill,
  parseSkillDocument,
  resolveInstalledSkills,
  resolveSkillInvocation,
  SkillFile,
  SkillMetadata,
} from "./skills"
import { ProjectId } from "./ids"

describe("Skill metadata", () => {
  test("uses the model and user invocation defaults", () => {
    const result = parseSkillDocument(
      "---\nname: review\ndescription: Review code\n---\nRun the review.",
      "fallback"
    )

    expect(result.metadata).toEqual(
      expect.objectContaining({
        name: "review",
        description: "Review code",
        disableModelInvocation: false,
        userInvokable: true,
      })
    )
    expect(result.content).toBe("Run the review.")
  })

  test("supports both user-invokable spellings", () => {
    const requested = parseSkillDocument(
      "---\nname: hidden\nuser-invokable: false\ndisable-model-invocation: true\n---\nHidden.",
      "fallback"
    )
    const compatible = parseSkillDocument(
      "---\nname: compatible\nuser-invocable: false\n---\nCompatible.",
      "fallback"
    )

    expect(requested.metadata.userInvokable).toBe(false)
    expect(requested.metadata.disableModelInvocation).toBe(true)
    expect(compatible.metadata.userInvokable).toBe(false)
  })
})

const installed = (
  id: string,
  name: string,
  scope: "installation" | "project"
) =>
  new InstalledSkill({
    id,
    catalogId: `source/${name}`,
    source: "owner/repository",
    sourceUrl: "https://skills.sh/owner/repository/skill",
    scope,
    projectId: scope === "project" ? ProjectId.make("project-1") : null,
    metadata: new SkillMetadata({
      name,
      disableModelInvocation: false,
      userInvokable: true,
    }),
    files: [new SkillFile({ path: "SKILL.md", content: name })],
    installedAt: 1,
  })

describe("Skill scope", () => {
  test("lets a Project Skill override an Installation Skill by name", () => {
    const global = installed("global", "review", "installation")
    const project = installed("project", "review", "project")

    expect(resolveInstalledSkills([global], [project])).toEqual([project])
  })

  test("resolves only user-invokable slash commands", () => {
    const review = installed("review", "review", "installation")
    const baseHidden = installed("hidden", "hidden", "installation")
    const hidden = new InstalledSkill({
      ...baseHidden,
      metadata: new SkillMetadata({
        ...baseHidden.metadata,
        userInvokable: false,
      }),
    })

    expect(resolveSkillInvocation("/review src", [review, hidden])).toEqual({
      skillId: "review",
      text: "src",
    })
    expect(resolveSkillInvocation("/hidden", [review, hidden])).toBeNull()
  })
})
