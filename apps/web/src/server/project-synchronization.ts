import { DurableObject } from "cloudflare:workers"
import {
  ProjectSynchronizationInput,
  SyncProjectRepositoryResult,
} from "@workspace/domain"
import { schema } from "@workspace/db"
import { drizzle } from "drizzle-orm/d1"
import { Schema } from "effect"
import { synchronizeProjectRepositoryDirect } from "./project-repository-sync"

const decodeInput = Schema.decodeUnknownSync(ProjectSynchronizationInput)
const decodeResult = Schema.decodeUnknownSync(SyncProjectRepositoryResult)
const encodeResult = Schema.encodeSync(SyncProjectRepositoryResult)

export class ProjectSynchronization extends DurableObject<Cloudflare.Env> {
  #pending = new Map<
    string,
    Promise<typeof SyncProjectRepositoryResult.Encoded | null>
  >()
  #tail: Promise<unknown> = Promise.resolve()

  synchronize(value: typeof ProjectSynchronizationInput.Encoded) {
    const input = decodeInput(value)
    const key = JSON.stringify(input)
    const pending = this.#pending.get(key)
    if (pending) return pending
    const operation = this.#tail.then(async () => {
      const cacheKey = JSON.stringify([
        input.repositoryRemote,
        input.defaultRef,
        input.sourceUrl,
        input.sourceRef,
      ])
      const previousKey = await this.ctx.storage.get<string>("source")
      const previous =
        previousKey === cacheKey
          ? await this.ctx.storage.get<
              typeof SyncProjectRepositoryResult.Encoded
            >("result")
          : undefined
      const result = await synchronizeProjectRepositoryDirect(
        drizzle(this.env.DB, { schema }),
        input.userId,
        input,
        previous ? decodeResult(previous) : undefined
      )
      if (!result) return null
      const encoded = encodeResult(result)
      await this.ctx.storage.put({ source: cacheKey, result: encoded })
      return encoded
    })
    this.#tail = operation.catch(() => undefined)
    this.#pending.set(key, operation)
    return operation.finally(() => this.#pending.delete(key))
  }
}
