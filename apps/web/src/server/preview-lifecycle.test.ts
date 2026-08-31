import { describe, expect, test } from "bun:test"

import {
  previewRetention,
  previewWorkerName,
  removePreviewWorker,
} from "./preview-lifecycle"

describe("Preview lifecycle", () => {
  test("derives the deployed Worker from a workers.dev Preview URL", () => {
    expect(
      previewWorkerName(
        "https://sylph-checkpoint-123.apingot.workers.dev/example"
      )
    ).toBe("sylph-checkpoint-123")
  })

  test("retains previews for seven days unless the deployment config overrides it", () => {
    expect(previewRetention()).toBe("7 days")
    expect(previewRetention("5")).toBe(5)
    expect(() => previewRetention("invalid")).toThrow(
      "Preview retention seconds must be a non-negative number"
    )
  })

  test("deletes an expired Preview with Cloudflare authorization", async () => {
    const observed: Array<{
      url: string
      method: string
      authorization: string
    }> = []

    await removePreviewWorker(
      {
        accountId: "account-1",
        token: "cloudflare-token",
        previewUrl: "https://sylph-checkpoint-123.apingot.workers.dev",
      },
      async (input, init) => {
        observed.push({
          url: String(input),
          method: init?.method ?? "GET",
          authorization: new Headers(init?.headers).get("authorization") ?? "",
        })
        return Response.json({ success: true })
      }
    )

    expect(observed).toEqual([
      {
        url: "https://api.cloudflare.com/client/v4/accounts/account-1/workers/scripts/sylph-checkpoint-123",
        method: "DELETE",
        authorization: "Bearer cloudflare-token",
      },
    ])
  })
})
