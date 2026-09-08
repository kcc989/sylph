import { WorkflowEntrypoint } from "cloudflare:workers"
import {
  WorkspaceId,
  WorkspaceProvisioningInput,
  WorkspaceMessageDeliveryInput,
} from "@workspace/domain"
import {
  provisioningParameters,
  messageDeliveryParameters,
} from "../../apps/web/src/server/workspace-workflow-parameters"

export class InputWorkflow extends WorkflowEntrypoint {
  async run(event) {
    return event.payload
  }
}

export default {
  async fetch(request, env) {
    const provision = new URL(request.url).pathname === "/provision"
    const params = provision
      ? provisioningParameters(
          new WorkspaceProvisioningInput({
            workspaceId: WorkspaceId.make("workspace"),
          })
        )
      : messageDeliveryParameters(
          new WorkspaceMessageDeliveryInput({
            workspaceId: WorkspaceId.make("workspace"),
            messageId: "message",
          })
        )
    const instance = await env.INPUT.create({ id: crypto.randomUUID(), params })
    return Response.json({ id: instance.id, params })
  },
}
