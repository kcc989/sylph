import { schema } from "@workspace/db"
import type { WorkspaceProvisioningInput } from "@workspace/domain"
import {
  activeProvisioningRequest,
  readProvisioningWorkspace,
} from "./workspace-provisioning-request"
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core"
import { Effect } from "effect"
import type { RepositoryStore } from "./repository-store"

type Database = BaseSQLiteDatabase<"async", unknown, typeof schema>

export const forkWorkspaceRepository = async (
  database: Database,
  input: WorkspaceProvisioningInput,
  repositories: Pick<RepositoryStore["Service"], "fork" | "inspect" | "head">
) => {
  const workspace = await readProvisioningWorkspace(database, input)
  if (!workspace || workspace.status !== "provisioning" || workspace.baseCommit)
    return
  await Effect.runPromise(
    repositories
      .fork({
        sourceName: workspace.baseArtifactRepo,
        name: workspace.workspaceArtifactRepo,
        description: `Workspace for ${workspace.title}`,
      })
      .pipe(
        Effect.catchIf(
          (error) => error.code === "ALREADY_EXISTS",
          () => repositories.inspect(workspace.workspaceArtifactRepo)
        )
      )
  )
  const head = await Effect.runPromise(
    repositories.head(workspace.workspaceArtifactRepo)
  )
  await database
    .update(schema.workspace)
    .set({
      baseCommit: workspace.repairCommit ?? head,
      forkHead: workspace.repairCommit ?? head,
      updatedAt: new Date(),
    })
    .where(activeProvisioningRequest(input))
}
