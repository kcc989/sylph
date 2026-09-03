import { Schema } from "effect"

import {
  InstalledSkill,
  ProjectId,
  resolveInstalledSkills,
  SkillMetadata,
  SkillFile,
} from "@workspace/domain"

const decodeSkillFilesJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Array(SkillFile))
)

type StoredSkill = {
  id: string
  catalog_id: string
  source: string
  source_url: string
  source_hash: string | null
  scope: "installation" | "project"
  project_id: string | null
  name: string
  description: string | null
  disable_model_invocation: number
  user_invokable: number
  files: string
  created_at: number
}

export const storedSkill = (row: StoredSkill) =>
  new InstalledSkill({
    id: row.id,
    catalogId: row.catalog_id,
    source: row.source,
    sourceUrl: row.source_url,
    sourceHash: row.source_hash ?? undefined,
    scope: row.scope,
    projectId: row.project_id ? ProjectId.make(row.project_id) : null,
    metadata: new SkillMetadata({
      name: row.name,
      description: row.description ?? undefined,
      disableModelInvocation: row.disable_model_invocation === 1,
      userInvokable: row.user_invokable === 1,
    }),
    files: decodeSkillFilesJson(row.files),
    installedAt: row.created_at * 1000,
  })

export const serializeInstalledSkill = (skill: InstalledSkill) => ({
  id: skill.id,
  catalogId: skill.catalogId,
  source: skill.source,
  sourceUrl: skill.sourceUrl,
  sourceHash: skill.sourceHash,
  scope: skill.scope,
  projectId: skill.projectId,
  metadata: {
    name: skill.metadata.name,
    description: skill.metadata.description,
    disableModelInvocation: skill.metadata.disableModelInvocation,
    userInvokable: skill.metadata.userInvokable,
  },
  files: skill.files.map((file) => ({
    path: file.path,
    content: file.content,
  })),
  installedAt: skill.installedAt,
})

export const loadInstalledSkills = async (
  database: D1Database,
  organizationId: string,
  projectId: string
) => {
  const result = await database
    .prepare(
      "SELECT id, catalog_id, source, source_url, source_hash, scope, project_id, name, description, disable_model_invocation, user_invokable, files, created_at FROM skill_installation WHERE organization_id = ? AND (scope = 'installation' OR (scope = 'project' AND project_id = ?)) ORDER BY name"
    )
    .bind(organizationId, projectId)
    .all<StoredSkill>()
  const skills = result.results.map(storedSkill)
  return resolveInstalledSkills(
    skills.filter((skill) => skill.scope === "installation"),
    skills.filter((skill) => skill.scope === "project")
  )
}
