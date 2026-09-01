import { describe, expect, test } from "bun:test"
import { InstalledSkill, SkillFile, SkillMetadata } from "@workspace/domain"

import {
  createWorkspaceSkillRegistry,
  runtimeSkillContent,
  runtimeSkillPolicy,
} from "./workspace-skills"

const skill = new InstalledSkill({
  id: "one",
  catalogId: "owner/repo/review",
  source: "owner/repo",
  sourceUrl: "https://skills.sh/owner/repo/review",
  scope: "installation",
  projectId: null,
  metadata: new SkillMetadata({
    name: "review",
    description: "Review code",
    disableModelInvocation: false,
    userInvokable: true,
  }),
  files: [
    new SkillFile({
      path: "SKILL.md",
      content: "---\nname: review\n---\nReview the code.",
    }),
    new SkillFile({ path: "reference/checklist.md", content: "Check it." }),
  ],
  installedAt: 1,
})

describe("Workspace Skill registry", () => {
  test("maps invocation metadata into runtime policy", () => {
    expect(runtimeSkillPolicy(skill)).toEqual({
      slash: true,
      autoinvoke: true,
    })
    expect(
      runtimeSkillPolicy(
        new InstalledSkill({
          ...skill,
          metadata: new SkillMetadata({
            name: "review",
            disableModelInvocation: true,
            userInvokable: false,
          }),
        })
      )
    ).toEqual({ slash: false, autoinvoke: false })
  })

  test("exposes supporting resources without putting them in the Project", async () => {
    const registry = createWorkspaceSkillRegistry()
    await registry.replace([skill])

    expect(registry.read("review", "reference/checklist.md")).toBe("Check it.")
    expect(() => registry.read("review", "../secret")).toThrow()
    expect(runtimeSkillContent(skill)).toContain("skill_read_resource")
  })
})
