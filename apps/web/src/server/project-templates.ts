import { schema } from "@workspace/db"
import { ProjectTemplate, ProjectTemplateCatalog } from "@workspace/domain"
import { and, eq } from "drizzle-orm"
import { Effect } from "effect"

import type { Database } from "@/server/organization-access"
import type { RepositoryStore } from "@/server/repository-store"

export const defaultProjectTemplateKey = "cloudflare-tanstack"

export const builtInProjectTemplates: ReadonlyArray<ProjectTemplate> = [
  new ProjectTemplate({
    key: defaultProjectTemplateKey,
    name: "Cloudflare app",
    description:
      "TanStack Start, shadcn/ui, Effect, and Better Auth on D1, deployed with Alchemy. Passes every Sylph Check out of the box.",
    sourceUrl: "https://github.com/kcc989/sylph-tanstack-template",
    sourceRef: "main",
  }),
]

export const projectTemplateCatalog = () =>
  new ProjectTemplateCatalog({
    templates: builtInProjectTemplates,
    defaultTemplate: defaultProjectTemplateKey,
  })

export const resolveProjectTemplate = (key: string) =>
  builtInProjectTemplates.find((template) => template.key === key)

const repositorySegment = (value: string, length: number) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, length)

export const templateRepositoryName = (
  organizationSlug: string,
  template: Pick<ProjectTemplate, "key" | "sourceRef">
) =>
  [
    repositorySegment(organizationSlug, 16),
    "template",
    repositorySegment(template.key, 20),
    repositorySegment(template.sourceRef, 16),
  ].join("-")

export interface TemplateRepositoryRecord {
  readonly artifactRepo: string
  readonly artifactRemote: string
  readonly headCommit: string
}

const importedTemplateRepository = async (
  repositories: RepositoryStore["Service"],
  name: string,
  template: ProjectTemplate
) => {
  const imported = await Effect.runPromise(
    repositories
      .import({
        name,
        description: `${template.name} template imported by Sylph`,
        sourceUrl: template.sourceUrl,
        sourceRef: template.sourceRef,
      })
      .pipe(
        Effect.catchIf(
          (error) => error.code === "ALREADY_EXISTS",
          () => repositories.inspect(name)
        )
      )
  )
  const headCommit = await Effect.runPromise(repositories.head(imported.name))
  return {
    artifactRepo: imported.name,
    artifactRemote: imported.remote,
    headCommit,
  } satisfies TemplateRepositoryRecord
}

export const ensureTemplateRepository = async (
  database: Database,
  repositories: RepositoryStore["Service"],
  organization: { id: string; slug: string },
  template: ProjectTemplate
): Promise<TemplateRepositoryRecord> => {
  const existing = await database
    .select({
      artifactRepo: schema.templateRepository.artifactRepo,
      artifactRemote: schema.templateRepository.artifactRemote,
      headCommit: schema.templateRepository.headCommit,
    })
    .from(schema.templateRepository)
    .where(
      and(
        eq(schema.templateRepository.organizationId, organization.id),
        eq(schema.templateRepository.sourceUrl, template.sourceUrl),
        eq(schema.templateRepository.sourceRef, template.sourceRef)
      )
    )
    .get()
  if (existing) return existing

  const record = await importedTemplateRepository(
    repositories,
    templateRepositoryName(organization.slug, template),
    template
  )
  const now = new Date()
  await database
    .insert(schema.templateRepository)
    .values({
      id: crypto.randomUUID(),
      organizationId: organization.id,
      key: template.key,
      sourceUrl: template.sourceUrl,
      sourceRef: template.sourceRef,
      artifactRepo: record.artifactRepo,
      artifactRemote: record.artifactRemote,
      headCommit: record.headCommit,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
  return record
}
