export const projectSlugSql = "SELECT slug FROM project WHERE id = ?"

interface ProjectSlugRow {
  readonly slug: string
}

export interface ProjectSlugDatabase {
  prepare(sql: string): {
    bind(...values: Array<string>): {
      first(): Promise<ProjectSlugRow | null>
    }
  }
}

export const readProjectSlug = async (
  database: ProjectSlugDatabase,
  projectId: string
) => {
  const row = await database.prepare(projectSlugSql).bind(projectId).first()
  if (!row) throw new Error("The Project for this deployment no longer exists")
  return row.slug
}

export const projectDeployEnvironment = (input: {
  slug: string
  checkpoint: string
  deployment: "preview" | "production"
}) => ({
  SYLPH_PROJECT: input.slug,
  SYLPH_CHECKPOINT: input.checkpoint,
  SYLPH_DEPLOYMENT: input.deployment,
})
