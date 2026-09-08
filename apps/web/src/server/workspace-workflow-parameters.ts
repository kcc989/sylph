import { Schema } from "effect"
import {
  WorkspaceMessageDeliveryInput,
  WorkspaceProvisioningInput,
} from "@workspace/domain"

export const provisioningParameters = Schema.encodeSync(
  WorkspaceProvisioningInput
)
export const messageDeliveryParameters = (
  input: typeof WorkspaceMessageDeliveryInput.Encoded
) =>
  Schema.encodeSync(WorkspaceMessageDeliveryInput)(
    Schema.decodeUnknownSync(WorkspaceMessageDeliveryInput)(input)
  )
