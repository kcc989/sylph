import { expect, test } from "bun:test"
import { checkDeployment, normalizeDomain } from "./config"

const input = {
  accountId: "a".repeat(32),
  token: "deploy-token",
  setupCode: "a-setup-code-with-at-least-32-characters",
  domain: "",
}
const fixture = () => {
  const paths: string[] = []
  const request = async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname
    paths.push(path)
    const result = path.endsWith("/verify")
      ? { status: "active" }
      : path.endsWith("/subdomain")
        ? { subdomain: "example" }
        : path === "/client/v4/zones"
          ? [{ id: "zone", name: "example.com", status: "active" }]
          : []
    return Response.json({ success: true, result })
  }
  return { paths, request }
}

test("workers.dev setup checks account services without needing zone permissions", async () => {
  const f = fixture()
  expect(await checkDeployment(input, f.request)).toEqual({
    domain: "",
    subdomain: "example",
  })
  expect(f.paths.some((path) => path.includes("/zones"))).toBe(false)
  expect(f.paths.some((path) => path.endsWith("/artifacts/namespaces"))).toBe(
    true
  )
})

test("custom domains require an active zone and no conflicting CNAME", async () => {
  const f = fixture()
  expect(
    await checkDeployment({ ...input, domain: "Sylph.Example.Com" }, f.request)
  ).toEqual({ domain: "sylph.example.com", subdomain: "example" })
  await expect(
    checkDeployment({ ...input, domain: "sylph.example.com" }, async (url) => {
      if (String(url).includes("dns_records"))
        return Response.json({ success: true, result: [{ type: "CNAME" }] })
      return f.request(url)
    })
  ).rejects.toThrow("CNAME")
})

test("account failures are actionable without disclosing credentials", async () => {
  await expect(
    checkDeployment(input, async () => new Response(null, { status: 403 }))
  ).rejects.toThrow("Deploy token: Cloudflare returned HTTP 403")
  expect(() => normalizeDomain("https://sylph.example.com/path")).toThrow(
    "hostname"
  )
  expect(() => normalizeDomain("*.example.com")).toThrow("hostname")
  expect(() => normalizeDomain("example.workers.dev")).toThrow("hostname")
})
