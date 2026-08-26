import type { ProjectId } from "@workspace/domain"
import { Context, Effect, Option, Schema } from "effect"

export class DatabaseError extends Schema.TaggedError<DatabaseError>()(
  "DatabaseError",
  {
    cause: Schema.Defect(),
  }
) {}

export interface ProjectRecord {
  readonly id: ProjectId
  readonly name: string
  readonly slug: string
}

export class ProjectRepository extends Context.Service<
  ProjectRepository,
  {
    readonly findById: (
      id: ProjectId
    ) => Effect.Effect<Option.Option<ProjectRecord>, DatabaseError>
  }
>()("@sylph/db/ProjectRepository") {}
