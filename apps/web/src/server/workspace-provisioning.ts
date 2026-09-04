import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers"
import { schema } from "@workspace/db"
import {
  InitializeWorkspaceRuntime,
  ProviderConnectionRequired,
  PreconditionFailed,
  OrganizationId,
  ProjectId,
  WorkspaceId,
  WorkspaceRequestInput,
  failureMessage,
} from "@workspace/domain"
import { drizzle } from "drizzle-orm/d1"
import { and, eq } from "drizzle-orm"
import { Effect, Schema } from "effect"
import {
  effectiveConnection,
  connectionCredential,
} from "./provider-connections"
import { requireWorkspaceProject } from "./organization-access"
import { repositoryStore } from "./repositories"
import { workspaceRuntime } from "./workspace-runtime"

const decodeInput = Schema.decodeUnknownSync(WorkspaceRequestInput)

export class WorkspaceProvisioning extends WorkflowEntrypoint<
  Cloudflare.Env,
  typeof WorkspaceRequestInput.Encoded
> {
  async run(
    event: WorkflowEvent<typeof WorkspaceRequestInput.Encoded>,
    step: WorkflowStep
  ) {
    const { workspaceId } = decodeInput(event.payload)
    const database = drizzle(this.env.DB, { schema })
    try {
      await step.do(
        "initialize-workspace",
        {
          retries: { limit: 2, delay: "2 seconds", backoff: "exponential" },
          timeout: "5 minutes",
        },
        async () => {
          const workspace = await database
            .select()
            .from(schema.workspace)
            .where(eq(schema.workspace.id, workspaceId))
            .get()
          if (!workspace || workspace.status !== "provisioning") return
          const project = await requireWorkspaceProject(
            database,
            workspace.projectId
          )
          const connection = await effectiveConnection(
            database,
            workspace.organizationId,
            workspace.ownerUserId
          )
          if (!connection)
            throw new ProviderConnectionRequired({
              message: "Connect an AI provider before starting this Workspace",
            })
          if (!workspace.baseCommit || !workspace.workspaceArtifactRepo)
            throw new PreconditionFailed({
              message: "Workspace Repository is not prepared",
            })
          const repository = await Effect.runPromise(
            repositoryStore().inspect(workspace.workspaceArtifactRepo)
          )
          await workspaceRuntime(workspaceId).initialize(
            new InitializeWorkspaceRuntime({
              workspaceId: WorkspaceId.make(workspaceId),
              organizationId: OrganizationId.make(workspace.organizationId),
              projectId: ProjectId.make(workspace.projectId),
              projectName: project.name,
              repositoryName: repository.name,
              repositoryRemote: repository.remote,
              projectRepositoryName: project.repositoryName,
              projectRepositoryRemote: project.repositoryRemote,
              defaultRef: workspace.branchName ?? project.defaultBranch,
              sourceRef: repository.defaultBranch,
              baseCommit: workspace.baseCommit,
              providerId: connection.providerId,
              modelId: connection.modelId,
              credential: await connectionCredential(connection),
            })
          )
          await database
            .update(schema.workspace)
            .set({
              status: "ready",
              syncStatus: "ready",
              errorSummary: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.workspace.id, workspaceId),
                eq(schema.workspace.status, "provisioning")
              )
            )
        }
      )
    } catch (cause) {
      await step.do("record-initialization-failure", async () => {
        await database
          .update(schema.workspace)
          .set({
            status: "error",
            errorSummary: failureMessage(
              cause,
              "Workspace initialization failed"
            ),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.workspace.id, workspaceId),
              eq(schema.workspace.status, "provisioning")
            )
          )
      })
      throw cause
    }
  }
}
