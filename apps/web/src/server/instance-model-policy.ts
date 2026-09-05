import { schema } from "@workspace/db"
import {
  InstanceModelPolicy,
  InvalidRequest,
  instanceModelEnabled,
  type InstanceModelIdentity,
} from "@workspace/domain"
import { eq } from "drizzle-orm"
import { Schema } from "effect"
import type { Database } from "./organization-access"
import { installationId } from "./installation"

const decodePolicy = Schema.decodeUnknownSync(InstanceModelPolicy)

export const readInstanceModelPolicy = async (database: Database) => {
  const installation = await database
    .select({ policy: schema.installation.modelPolicy })
    .from(schema.installation)
    .where(eq(schema.installation.id, installationId))
    .get()
  return decodePolicy(
    installation?.policy ?? { models: [], defaultModel: null }
  )
}

export const assertInstanceModelEnabled = async (
  database: Database,
  model: InstanceModelIdentity
) => {
  if (!instanceModelEnabled(await readInstanceModelPolicy(database), model)) {
    throw new InvalidRequest({
      message:
        "This model is not enabled for this Sylph instance. Choose an enabled model in the workspace picker.",
    })
  }
}
