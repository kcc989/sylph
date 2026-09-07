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
  WorkspaceProvisioningInput,
  failureMessage,
} from "@workspace/domain"
import { drizzle } from "drizzle-orm/d1"
import { assertInstanceModelEnabled } from "./instance-model-policy"
import { Effect, Schema } from "effect"
import {
  effectiveConnection,
  connectionCredential,
} from "./provider-connections"
import { requireWorkspaceProject } from "./organization-access"
import { repositoryStore } from "./repositories"
import { forkWorkspaceRepository } from "./workspace-repository-provisioning"
import { synchronizeProjectRepository } from "./project-repository-sync"
import { workspaceRuntime } from "./workspace-runtime"
import {
  activeProvisioningRequest,
  readProvisioningWorkspace,
} from "./workspace-provisioning-request"

const decodeInput = Schema.decodeUnknownSync(WorkspaceProvisioningInput)

export class WorkspaceProvisioning extends WorkflowEntrypoint<
  Cloudflare.Env,
  typeof WorkspaceProvisioningInput.Encoded
> {
  async run(
    event: WorkflowEvent<typeof WorkspaceProvisioningInput.Encoded>,
    step: WorkflowStep
  ) {
    const input = decodeInput(event.payload)
    const { workspaceId } = input
    const database = drizzle(this.env.DB, { schema })
    try {
      await step.do("prepare-repository", async () => {
        const workspace = await readProvisioningWorkspace(database, input)
        if (
          !workspace ||
          workspace.status !== "provisioning" ||
          workspace.baseCommit
        )
          return
        const project = await requireWorkspaceProject(
          database,
          workspace.projectId
        )
        await synchronizeProjectRepository(database, workspace.ownerUserId, {
          id: project.id,
          repositoryName: project.repositoryName,
          repositoryRemote: project.repositoryRemote,
          defaultRef: project.defaultBranch,
          sourceUrl: project.importOriginUrl,
          sourceRef: project.importOriginBranch,
        })
      })
      await step.do("fork-repository", () =>
        forkWorkspaceRepository(database, input, repositoryStore())
      )
      await step.do(
        "initialize-workspace",
        {
          retries: {
            limit: 2,
            delay: "2 seconds",
            backoff: "exponential",
          },
          timeout: "5 minutes",
        },
        async () => {
          const workspace = await readProvisioningWorkspace(database, input)
          if (!workspace || workspace.status !== "provisioning") return
          const project = await requireWorkspaceProject(
            database,
            workspace.projectId
          )
          if (input.restart?.model)
            await assertInstanceModelEnabled(database, input.restart.model)
          const connection = await effectiveConnection(
            database,
            workspace.organizationId,
            workspace.ownerUserId,
            input.restart?.model
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
          const credential = await connectionCredential(connection)
          if (!(await readProvisioningWorkspace(database, input))) return
          if (input.restart)
            await workspaceRuntime(workspaceId)
              .evict()
              .catch(() => undefined)
          try {
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
                credential,
                archivedAt: workspace.archivedAt?.getTime() ?? null,
              })
            )
          } catch (cause) {
            if (await readProvisioningWorkspace(database, input))
              await workspaceRuntime(workspaceId)
                .evict()
                .catch(() => undefined)
            throw cause
          }
          await database
            .update(schema.workspace)
            .set({
              status: workspace.archivedAt ? "archived" : "ready",
              syncStatus: "ready",
              errorSummary: null,
              updatedAt: new Date(),
            })
            .where(activeProvisioningRequest(input))
        }
      )
    } catch (cause) {
      await step.do("record-initialization-failure", async () => {
        const workspace = await readProvisioningWorkspace(database, input)
        if (!workspace) return
        await database
          .update(schema.workspace)
          .set({
            status: workspace.archivedAt ? "archived" : "error",
            errorSummary: failureMessage(
              cause,
              "Workspace initialization failed"
            ),
            updatedAt: new Date(),
          })
          .where(activeProvisioningRequest(input))
      })
      throw cause
    }
  }
}
