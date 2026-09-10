import { Schema } from "effect"
import {
  WorkspaceSmokeRequest,
  WorkspaceSmokeBudgetOverride,
} from "@workspace/domain"

export const smokeModel = "x-ai/grok-4.6"

export const smokeModelConfiguration = {
  agents: {
    title: { model: `openrouter/${smokeModel}` },
    compaction: { model: `openrouter/${smokeModel}` },
  },
  providers: {
    openrouter: { models: { [smokeModel]: { body: { max_tokens: 4096 } } } },
  },
}

type BudgetStorage = {
  get(key: string): Promise<number | undefined>
  put(key: string, value: number): Promise<void>
}

export const reserveSmokeRequest = async (
  request: Request,
  storage: {
    transaction<T>(run: (transaction: BudgetStorage) => Promise<T>): Promise<T>
  },
  options?: { workspaceId?: string; override?: string }
) => {
  const override = options?.override
    ? Schema.decodeUnknownSync(
        Schema.fromJsonString(WorkspaceSmokeBudgetOverride)
      )(options.override)
    : undefined
  const maximumUsd =
    override?.workspaceId === options?.workspaceId
      ? (override?.maximumUsd ?? 4)
      : 4
  if (new URL(request.url).hostname !== "openrouter.ai")
    throw new Error("Smoke run permits only OpenRouter Grok 4.6 requests")
  const decoded = Schema.decodeUnknownOption(WorkspaceSmokeRequest)(
    await request.clone().json()
  )
  if (decoded._tag === "None")
    throw new Error(
      "Smoke run permits only Grok 4.6 text requests without fallback or plugins"
    )
  const body = decoded.value
  const output = Math.max(body.max_tokens ?? 0, body.max_completion_tokens ?? 0)
  if (!Number.isInteger(output) || output <= 0 || output > 4096)
    throw new Error("Smoke requests require an output limit of at most 4096")
  const bytes = (await request.clone().arrayBuffer()).byteLength
  const key = "sylph:smoke:reserved-microdollars"
  const maximumCost = (bytes + 8192) * 2 + output * 6
  await storage.transaction(async (transaction) => {
    const reserved = Schema.decodeUnknownSync(Schema.Number)(
      (await transaction.get(key)) ?? 0
    )
    if (reserved + maximumCost > maximumUsd * 1_000_000)
      throw new Error(
        `Smoke run stopped at its $${maximumUsd} conservative request budget`
      )
    await transaction.put(key, reserved + maximumCost)
  })
}
