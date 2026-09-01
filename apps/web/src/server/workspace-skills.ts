import { type InstalledSkill, parseSkillDocument } from "@workspace/domain"

export const createWorkspaceSkillRegistry = () => {
  let skills: ReadonlyArray<InstalledSkill> = []
  let reload: () => Promise<void> = async () => undefined

  return {
    connect(nextReload: () => Promise<void>) {
      reload = nextReload
    },
    list() {
      return skills
    },
    async replace(nextSkills: ReadonlyArray<InstalledSkill>) {
      skills = nextSkills
      await reload()
    },
    read(skillName: string, requestedPath: string) {
      const path = requestedPath.replaceAll("\\", "/")
      if (
        path.startsWith("/") ||
        path.split("/").some((part) => part === ".." || part === "")
      ) {
        throw new Error("Skill resource path is invalid")
      }
      const skill = skills.find(
        (candidate) => candidate.metadata.name === skillName
      )
      if (!skill) throw new Error(`Skill ${skillName} is not installed`)
      const file = skill.files.find((candidate) => candidate.path === path)
      if (!file) throw new Error(`Skill resource ${path} does not exist`)
      return file.content
    },
  }
}

export type WorkspaceSkillRegistry = ReturnType<
  typeof createWorkspaceSkillRegistry
>

export const runtimeSkillContent = (skill: InstalledSkill) => {
  const document = skill.files.find((file) => file.path === "SKILL.md")
  if (!document) throw new Error(`Skill ${skill.metadata.name} has no SKILL.md`)
  const content = parseSkillDocument(
    document.content,
    skill.metadata.name
  ).content.trim()
  const resources = skill.files
    .filter((file) => file.path !== "SKILL.md")
    .map((file) => file.path)
    .sort()
  if (resources.length === 0) return content
  return [
    content,
    "",
    "Supporting resources are available through skill_read_resource:",
    ...resources.map((path) => `- ${path}`),
  ].join("\n")
}

export const runtimeSkillPolicy = (skill: InstalledSkill) => ({
  slash: skill.metadata.userInvokable,
  autoinvoke: !skill.metadata.disableModelInvocation,
})
