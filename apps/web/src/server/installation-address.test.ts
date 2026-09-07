import { expect, test } from "bun:test"
import {
  canonicalInstallationResponse,
  installationOrigin,
} from "./installation-address"

test("workers.dev and custom domains use the configured origin for authentication", () => {
  const request = new Request("https://old.account.workers.dev/setup")
  expect(installationOrigin(request, "https://sylph.example.com")).toBe(
    "https://sylph.example.com"
  )
  expect(installationOrigin(request, "")).toBe(
    "https://old.account.workers.dev"
  )
  expect(
    installationOrigin(new Request("http://localhost:3000/setup"), "")
  ).toBe("http://localhost:3000")
})

test("address changes preserve paths and queries but do not forward mutations", () => {
  const moved = canonicalInstallationResponse(
    new Request("https://old.account.workers.dev/setup?tab=github"),
    "https://sylph.example.com"
  )
  expect(moved?.headers.get("location")).toBe(
    "https://sylph.example.com/setup?tab=github"
  )
  expect(
    canonicalInstallationResponse(
      new Request("https://old.account.workers.dev/api/auth/sign-in", {
        method: "POST",
      }),
      "https://sylph.example.com"
    )?.status
  ).toBe(421)
  expect(
    canonicalInstallationResponse(
      new Request("https://sylph.example.com/setup"),
      "https://sylph.example.com"
    )
  ).toBeNull()
})
