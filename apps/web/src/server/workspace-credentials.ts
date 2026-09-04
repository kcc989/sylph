import type { WorkspaceStorage } from "./workspace-filesystem"
import type { OpenCodeCredential } from "@workspace/domain"
import { Context, Layer, Schema } from "effect"
import { activateCredentialAndWaitForCatalog } from "./opencode-credential-activation"
import {
  connectOpenCodeKeyCredential,
  OpenCodeCredentialReloadRequired,
} from "./opencode-key-credential"
import type { OpenAIOAuthRequestState } from "./opencode-oauth-request"
import { providerFailureDetail } from "./workspace-error-summary"

type WorkspaceCredentialClient = Parameters<
  typeof connectOpenCodeKeyCredential
>[0] & {
  credential: { activate: (input: { credentialID: string }) => Promise<void> }
}

const subscriptionProviderId = "openai"
export const subscriptionCredentialLabel = "Sylph connection"

const installWorkspaceCredential = async (
  opencode: WorkspaceCredentialClient,
  storage: WorkspaceStorage,
  openAIOAuth: OpenAIOAuthRequestState,
  providerId: string,
  credential: OpenCodeCredential
) => {
  try {
    await waitForOpenCodeIntegration(opencode, providerId)
  } catch {
    throw new Error(`OpenCode could not load the ${providerId} integration`)
  }

  if (credential.type === "key") {
    if (providerId === subscriptionProviderId) {
      openAIOAuth.active = false
      openAIOAuth.accountID = null
    }
    try {
      await connectOpenCodeKeyCredential(opencode, {
        providerId,
        key: credential.key,
        configuration: credential.configuration,
      })
    } catch (error) {
      if (error instanceof OpenCodeCredentialReloadRequired) {
        throw error
      }
      const detail = providerFailureDetail(error)
      throw new Error(
        detail
          ? `OpenCode rejected the ${providerId} credential: ${detail}`
          : `OpenCode rejected the ${providerId} credential without a diagnostic`
      )
    }
    return
  }

  if (providerId === subscriptionProviderId) {
    const accountID = credential.metadata?.["accountID"]
    openAIOAuth.active = true
    openAIOAuth.accountID = Schema.is(Schema.String)(accountID)
      ? accountID
      : null
  }

  const existing = storage.sql
    .exec<{ id: string }>(
      "SELECT id FROM credential WHERE integration_id = ? AND label = ? LIMIT 1",
      providerId,
      subscriptionCredentialLabel
    )
    .toArray()[0]
  const credentialId = existing?.id ?? `cred_sylph_${crypto.randomUUID()}`
  const switchCredentialId = `cred_sylph_switch_${providerId}`
  const now = Date.now()

  storage.sql.exec(
    "UPDATE credential SET active = 0, time_updated = ? WHERE integration_id = ?",
    now,
    providerId
  )

  if (existing) {
    storage.sql.exec(
      "UPDATE credential SET value = ?, method_id = ?, active = 0, time_updated = ? WHERE id = ?",
      JSON.stringify(credential),
      credential.methodID,
      now,
      credentialId
    )
  } else {
    storage.sql.exec(
      "INSERT INTO credential (id, integration_id, label, value, connector_id, method_id, active, time_created, time_updated) VALUES (?, ?, ?, ?, NULL, ?, 0, ?, ?)",
      credentialId,
      providerId,
      subscriptionCredentialLabel,
      JSON.stringify(credential),
      credential.methodID,
      now,
      now
    )
  }

  storage.sql.exec(
    "INSERT INTO credential (id, integration_id, label, value, connector_id, method_id, active, time_created, time_updated) VALUES (?, ?, ?, ?, NULL, ?, 1, ?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value, method_id = excluded.method_id, active = 1, time_updated = excluded.time_updated",
    switchCredentialId,
    providerId,
    "Sylph connection switch",
    JSON.stringify(credential),
    credential.methodID,
    now,
    now
  )
  await activateCredentialAndWaitForCatalog(opencode, credentialId)
  storage.sql.exec("DELETE FROM credential WHERE id = ?", switchCredentialId)
}

const waitForOpenCodeIntegration = async (
  opencode: WorkspaceCredentialClient,
  providerId: string
) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const integration = await opencode.integration.get({
      integrationID: providerId,
    })

    if (integration.data) return

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(`OpenCode integration ${providerId} did not start`)
}

export class WorkspaceCredentials extends Context.Service<
  WorkspaceCredentials,
  {
    install: (
      providerId: string,
      credential: OpenCodeCredential
    ) => Promise<void>
    waitForIntegration: (providerId: string) => Promise<void>
  }
>()("@sylph/WorkspaceCredentials") {
  static layer(
    source: Promise<WorkspaceCredentialClient>,
    storage: WorkspaceStorage,
    oauth: OpenAIOAuthRequestState
  ) {
    return Layer.succeed(WorkspaceCredentials, {
      install: async (providerId, credential) =>
        installWorkspaceCredential(
          await source,
          storage,
          oauth,
          providerId,
          credential
        ),
      waitForIntegration: async (providerId) =>
        waitForOpenCodeIntegration(await source, providerId),
    })
  }
}
