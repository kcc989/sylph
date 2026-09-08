import { expect, test } from "bun:test"
import {
  exportPreservedD1,
  inspectRetainedInstallation,
  type PreservationCloudflareAccess,
} from "./preservation-cloudflare"

const source = {
  accountId: "account",
  stage: "old",
  sourceCommit: "a".repeat(40),
  websiteWorker: "website",
  runtimeWorkers: ["runtime"],
  databaseId: "old-db",
  installationId: "default",
  claimedByUserId: "owner",
}

test("preservation resolves old runtime bindings without retaining Worker secret values", async () => {
  const requests: string[] = []
  const access: PreservationCloudflareAccess = {
    accountId: "account",
    token: "private-token",
    fetch: async (input) => {
      const url = String(input)
      requests.push(url)
      if (url.endsWith("deployments"))
        return Response.json({
          success: true,
          result: {
            deployments: [
              { versions: [{ version_id: "old-version", percentage: 100 }] },
            ],
          },
        })
      return Response.json({
        success: true,
        result: {
          bindings: [
            { name: "DB", type: "d1", id: "old-db" },
            {
              name: "WORKSPACES",
              type: "durable_object_namespace",
              namespace_id: "retained-namespace",
            },
            {
              name: "CREDENTIAL_ENCRYPTION_KEY",
              type: "secret_text",
              text: "never-retain-in-inventory",
            },
          ],
        },
      })
    },
  }
  const inventory = await inspectRetainedInstallation(access, source)
  expect(
    inventory.bindings.find((binding) => binding.name === "WORKSPACES")
      ?.resourceId
  ).toBe("retained-namespace")
  expect(JSON.stringify(inventory)).not.toContain("never-retain-in-inventory")
  expect(requests).toHaveLength(4)
  await expect(
    inspectRetainedInstallation(access, {
      ...source,
      accountId: "other-account",
    })
  ).rejects.toThrow("account")
  expect(requests).toHaveLength(4)
})

test("D1 SQL download does not forward the Cloudflare bearer token", async () => {
  const access: PreservationCloudflareAccess = {
    accountId: "account",
    token: "private-token",
    fetch: async (input, init) => {
      if (String(input).includes("api.cloudflare.com")) {
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          "Bearer private-token"
        )
        expect(init?.method).toBe("POST")
        return Response.json({
          success: true,
          result: {
            status: "complete",
            result: { signed_url: "https://download.example.com/temporary" },
          },
        })
      }
      expect(new Headers(init?.headers).get("Authorization")).toBeNull()
      expect(init?.redirect).toBe("error")
      return new Response("CREATE TABLE preserved (id TEXT);")
    },
  }
  expect(await exportPreservedD1(access, "old-db")).toBe(
    "CREATE TABLE preserved (id TEXT);"
  )
})

test("failed Cloudflare envelopes stop preservation", async () => {
  const access: PreservationCloudflareAccess = {
    accountId: "account",
    token: "private-token",
    fetch: async () =>
      Response.json({ success: false, result: { status: "error" } }),
  }
  await expect(exportPreservedD1(access, "old-db")).rejects.toThrow("failed")
})
