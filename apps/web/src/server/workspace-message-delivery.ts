import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers"
import { schema } from "@workspace/db"
import {
  WorkspaceMessageDeliveryInput,
  WorkspacePromptInput,
  WorkspaceRuntimePromptInput,
  PreconditionFailed,
  failureMessage,
} from "@workspace/domain"
import { drizzle } from "drizzle-orm/d1"
import { eq } from "drizzle-orm"
import { Schema } from "effect"
import { dispatchPendingWorkspacePrompt } from "./workspace-pending-prompts"
import {
  effectiveConnection,
  connectionCredential,
} from "./provider-connections"
import { workspaceRuntime } from "./workspace-runtime"

export class WorkspaceMessageDelivery extends WorkflowEntrypoint<
  Cloudflare.Env,
  typeof WorkspaceMessageDeliveryInput.Encoded
> {
  async run(
    event: WorkflowEvent<typeof WorkspaceMessageDeliveryInput.Encoded>,
    step: WorkflowStep
  ) {
    const input = Schema.decodeUnknownSync(WorkspaceMessageDeliveryInput)(
      event.payload
    )
    const database = drizzle(this.env.DB, { schema })
    try {
      for (let attempt = 0; attempt < 900; attempt += 1) {
        const result = await step.do(
          `deliver-${attempt}`,
          {
            retries: { limit: 5, delay: "5 seconds", backoff: "exponential" },
            timeout: "2 minutes",
          },
          () =>
            dispatchPendingWorkspacePrompt(database, input, async (row) => {
              const workspace = await database
                .select()
                .from(schema.workspace)
                .where(eq(schema.workspace.id, input.workspaceId))
                .get()
              if (!workspace) return
              const prompt = await Schema.decodeUnknownPromise(
                WorkspacePromptInput
              )(row.payload)
              const connection = await effectiveConnection(
                database,
                workspace.organizationId,
                row.userId,
                prompt.model
              )
              if (!connection)
                throw new PreconditionFailed({
                  message:
                    "Reconnect the message sender's provider to deliver the queued message",
                })
              const runtime = workspaceRuntime(input.workspaceId)
              if ((await runtime.snapshot()).status === "running")
                return "waiting"
              await runtime.prompt(
                new WorkspaceRuntimePromptInput({
                  workspaceId: input.workspaceId,
                  messageId: row.id,
                  text: prompt.text,
                  model: {
                    providerId: connection.providerId,
                    modelId: connection.modelId,
                    variant:
                      prompt.model?.providerId === connection.providerId &&
                      prompt.model.modelId === connection.modelId
                        ? prompt.model.variant
                        : undefined,
                  },
                  credential: await connectionCredential(connection),
                })
              )
            })
        )
        if (result === "done") return
        await step.sleep(
          `wait-${attempt}`,
          attempt < 30 ? "2 seconds" : "5 seconds"
        )
      }
      throw new PreconditionFailed({
        message:
          "The message is saved but delivery timed out. Retry when the workspace is ready.",
      })
    } catch (cause) {
      await step.do("record-delivery-failure", async () => {
        await database
          .update(schema.workspacePendingPrompt)
          .set({
            errorSummary: failureMessage(cause, "Message delivery failed"),
          })
          .where(eq(schema.workspacePendingPrompt.id, input.messageId))
      })
      throw cause
    }
  }
}
