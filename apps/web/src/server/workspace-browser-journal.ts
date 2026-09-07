import {
  BrowserActionReceipt,
  BrowserJourneyPolicy,
  BrowserJourneyResult,
  BrowserPolicyException,
} from "@workspace/domain"
import { Schema } from "effect"

type BrowserJournalValue =
  | BrowserJourneyPolicy
  | BrowserJourneyResult
  | BrowserPolicyException
  | BrowserActionReceipt
  | number

export type BrowserJournalStorage = {
  get(key: string): Promise<BrowserJournalValue | undefined>
  put(key: string, value: BrowserJournalValue): Promise<void>
  list(options: { prefix: string }): Promise<Map<string, BrowserJournalValue>>
}

export const browserJournal = (storage: BrowserJournalStorage) => {
  const read = async <A>(
    key: string,
    schema: Schema.ConstraintDecoder<A>
  ): Promise<A | undefined> => {
    const value = await storage.get(key)
    return value === undefined
      ? undefined
      : Schema.decodeUnknownSync(schema)(value)
  }
  return {
    policy: () => read("browser-policy", BrowserJourneyPolicy),
    async savePolicy(policy: BrowserJourneyPolicy) {
      await storage.put(`browser-policy-history:${policy.revision}`, policy)
      await storage.put("browser-policy", policy)
    },
    async nextOrdinal() {
      const value = (await read("browser-ordinal", Schema.Int)) ?? 0
      await storage.put("browser-ordinal", value + 1)
      return value + 1
    },
    async results() {
      const values = await storage.list({ prefix: "browser-journey:" })
      return [...values.values()].map((value) =>
        Schema.decodeUnknownSync(BrowserJourneyResult)(value)
      )
    },
    result: (id: string) => read(`browser-journey:${id}`, BrowserJourneyResult),
    saveResult: (result: BrowserJourneyResult) =>
      storage.put(`browser-journey:${result.id}`, result),
    exception: () => read("browser-exception", BrowserPolicyException),
    async saveException(exception: BrowserPolicyException) {
      await storage.put(
        `browser-exception-history:${exception.ordinal}`,
        exception
      )
      await storage.put("browser-exception", exception)
    },
    receipt: (id: string) =>
      read(`browser-receipt:${id}`, BrowserActionReceipt),
    saveReceipt: (id: string, receipt: BrowserActionReceipt) =>
      storage.put(`browser-receipt:${id}`, receipt),
  }
}
export type BrowserJournal = ReturnType<typeof browserJournal>
