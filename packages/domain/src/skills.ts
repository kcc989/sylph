import { Schema } from "effect"

import { toolJsonSchema } from "./json-schema"

import { ProjectId } from "./ids"

export const SkillScope = Schema.Literals(["installation", "project"])
export type SkillScope = typeof SkillScope.Type

export class SkillFile extends Schema.Class<SkillFile>(
  "@sylph/domain/SkillFile"
)({
  path: Schema.NonEmptyString,
  content: Schema.String,
}) {}

export class SkillMetadata extends Schema.Class<SkillMetadata>(
  "@sylph/domain/SkillMetadata"
)({
  name: Schema.NonEmptyString,
  description: Schema.optional(Schema.String),
  disableModelInvocation: Schema.Boolean,
  userInvokable: Schema.Boolean,
}) {}

export class InstalledSkill extends Schema.Class<InstalledSkill>(
  "@sylph/domain/InstalledSkill"
)({
  id: Schema.NonEmptyString,
  catalogId: Schema.NonEmptyString,
  source: Schema.NonEmptyString,
  sourceUrl: Schema.NonEmptyString,
  sourceHash: Schema.optional(Schema.String),
  scope: SkillScope,
  projectId: Schema.NullOr(ProjectId),
  metadata: SkillMetadata,
  files: Schema.Array(SkillFile),
  installedAt: Schema.Number,
}) {}

export class SkillInstallInput extends Schema.Class<SkillInstallInput>(
  "@sylph/domain/SkillInstallInput"
)({
  organizationId: Schema.NonEmptyString,
  projectId: Schema.optional(ProjectId),
  catalogId: Schema.NonEmptyString,
  sourceHash: Schema.NonEmptyString,
}) {}

export class SkillCatalogRequest extends Schema.Class<SkillCatalogRequest>(
  "@sylph/domain/SkillCatalogRequest"
)({
  query: Schema.optional(Schema.String),
}) {}

export class SkillDetailRequest extends Schema.Class<SkillDetailRequest>(
  "@sylph/domain/SkillDetailRequest"
)({
  owner: Schema.NonEmptyString,
  repository: Schema.NonEmptyString,
  skill: Schema.NonEmptyString,
}) {}

export class SkillCatalogEntry extends Schema.Class<SkillCatalogEntry>(
  "@sylph/domain/SkillCatalogEntry"
)({
  catalogId: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  source: Schema.NonEmptyString,
  installs: Schema.NonEmptyString,
  sourcePageUrl: Schema.NonEmptyString,
}) {}

export class SkillReview extends Schema.Class<SkillReview>(
  "@sylph/domain/SkillReview"
)({
  catalogId: Schema.NonEmptyString,
  source: Schema.NonEmptyString,
  sourcePageUrl: Schema.NonEmptyString,
  repositoryUrl: Schema.NonEmptyString,
  sourceHash: Schema.String,
  metadata: SkillMetadata,
  files: Schema.Array(SkillFile),
  content: Schema.String,
}) {}

export class SkillResourceInput extends Schema.Class<SkillResourceInput>(
  "@sylph/domain/SkillResourceInput"
)({
  skill: Schema.NonEmptyString,
  path: Schema.NonEmptyString,
}) {}

export const SkillResourceJsonSchema = toolJsonSchema(SkillResourceInput)

const frontmatterLine = /^([a-zA-Z0-9_-]+):\s*(.*?)\s*$/

const scalar = (value: string) => {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

const booleanValue = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback
  return scalar(value).toLowerCase() !== "false"
}

export const parseSkillDocument = (document: string, fallbackName: string) => {
  const normalized = document.replaceAll("\r\n", "\n")
  if (!normalized.startsWith("---\n")) {
    return {
      metadata: new SkillMetadata({
        name: fallbackName,
        disableModelInvocation: false,
        userInvokable: true,
      }),
      content: normalized,
    }
  }

  const end = normalized.indexOf("\n---\n", 4)
  if (end < 0) {
    return {
      metadata: new SkillMetadata({
        name: fallbackName,
        disableModelInvocation: false,
        userInvokable: true,
      }),
      content: normalized,
    }
  }

  const values = new Map<string, string>()
  for (const line of normalized.slice(4, end).split("\n")) {
    const match = frontmatterLine.exec(line)
    if (match) values.set(match[1], match[2])
  }

  return {
    metadata: new SkillMetadata({
      name: scalar(values.get("name") ?? fallbackName) || fallbackName,
      description: values.has("description")
        ? scalar(values.get("description") ?? "")
        : undefined,
      disableModelInvocation: booleanValue(
        values.get("disable-model-invocation"),
        false
      ),
      userInvokable: booleanValue(
        values.get("user-invokable") ?? values.get("user-invocable"),
        true
      ),
    }),
    content: normalized.slice(end + 5),
  }
}

export const resolveInstalledSkills = (
  installationSkills: ReadonlyArray<InstalledSkill>,
  projectSkills: ReadonlyArray<InstalledSkill>
) => {
  const resolved = new Map<string, InstalledSkill>()
  for (const skill of installationSkills) {
    resolved.set(skill.metadata.name, skill)
  }
  for (const skill of projectSkills) {
    resolved.set(skill.metadata.name, skill)
  }
  return [...resolved.values()].sort((left, right) =>
    left.metadata.name.localeCompare(right.metadata.name)
  )
}

export const resolveSkillInvocation = (
  text: string,
  skills: ReadonlyArray<InstalledSkill>
) => {
  const match = /^\/([a-zA-Z0-9._-]+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  if (!match) return null
  const skill = skills.find(
    (candidate) =>
      candidate.metadata.userInvokable && candidate.metadata.name === match[1]
  )
  if (!skill) return null
  return { skillId: skill.metadata.name, text: match[2]?.trim() ?? "" }
}

export class WorkspaceSkillReloadResult extends Schema.Class<WorkspaceSkillReloadResult>(
  "@sylph/domain/WorkspaceSkillReloadResult"
)({
  skills: Schema.Int,
}) {}
