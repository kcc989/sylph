import { isInvalidRequestError } from "@opencode-ai/client"
import type { OpenCodeKeyConfiguration } from "@workspace/domain"

import {
  type OpenCodeCatalogRefresh,
  updateCredentialAndWaitForCatalog,
} from "./opencode-credential-activation"

interface OpenCodeKeyCredentialClient extends OpenCodeCatalogRefresh {
  readonly credential: {
    readonly remove: (input: { credentialID: string }) => Promise<void>
  }
  readonly integration: {
    readonly connect: {
      readonly key: (input: {
        integrationID: string
        key: string
        answer?: OpenCodeKeyConfiguration
      }) => Promise<void>
    }
    readonly get: (input: { integrationID: string }) => Promise<{
      data: {
        connections: ReadonlyArray<
          { type: "credential"; id: string } | { type: "env"; name: string }
        >
      } | null
    }>
  }
}

interface OpenCodeKeyCredentialInput {
  readonly providerId: string
  readonly key: string
  readonly configuration?: OpenCodeKeyConfiguration
}

const formAnswerRejection = "Key method does not accept a form answer"

export class OpenCodeCredentialReloadRequired extends Error {}

export const connectOpenCodeKeyCredential = async (
  opencode: OpenCodeKeyCredentialClient,
  input: OpenCodeKeyCredentialInput
) => {
  const connect = () =>
    opencode.integration.connect.key({
      integrationID: input.providerId,
      key: input.key,
      answer: input.configuration,
    })

  try {
    await updateCredentialAndWaitForCatalog(opencode, connect)
    return
  } catch (error) {
    if (
      !isInvalidRequestError(error) ||
      error.message !== formAnswerRejection
    ) {
      throw error
    }
  }

  const integration = await opencode.integration.get({
    integrationID: input.providerId,
  })
  const credentialIds = (integration.data?.connections ?? []).flatMap(
    (connection) => (connection.type === "credential" ? [connection.id] : [])
  )

  if (credentialIds.length === 0) {
    await updateCredentialAndWaitForCatalog(opencode, () =>
      opencode.integration.connect.key({
        integrationID: input.providerId,
        key: input.key,
      })
    )
    return
  }

  for (const credentialID of credentialIds) {
    await opencode.credential.remove({ credentialID })
  }
  throw new OpenCodeCredentialReloadRequired()
}
