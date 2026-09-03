import { expect, test } from "bun:test"
import {
  callbackCode,
  conversionUrl,
  creationUrl,
  decodeConversion,
  manifestFor,
  manifestFormHtml,
} from "../github-app-manifest"

const input = {
  name: "Sylph (example)",
  sylphUrl: "https://sylph.example.workers.dev",
  redirectUrl: "http://127.0.0.1:4321/callback",
}

test("the manifest registers the Better Auth callback and repository permissions", () => {
  const manifest = manifestFor(input)

  expect(manifest.callback_urls).toEqual([
    "https://sylph.example.workers.dev/api/auth/callback/github",
  ])
  expect(manifest.redirect_url).toBe(input.redirectUrl)
  expect(manifest.request_oauth_on_install).toBe(true)
  expect(manifest.public).toBe(false)
  expect(manifest.hook_attributes.active).toBe(false)
  expect(manifest.default_permissions).toEqual({
    contents: "write",
    pull_requests: "write",
    emails: "read",
  })
  expect(manifest.default_events).toEqual([])
})

test("the creation URL targets the personal account or an organization", () => {
  expect(creationUrl("", "abc")).toBe(
    "https://github.com/settings/apps/new?state=abc"
  )
  expect(creationUrl("my org", "a b")).toBe(
    "https://github.com/organizations/my%20org/settings/apps/new?state=a%20b"
  )
  expect(conversionUrl("c/o de")).toBe(
    "https://api.github.com/app-manifests/c%2Fo%20de/conversions"
  )
})

test("the form escapes the manifest and submits itself", () => {
  const html = manifestFormHtml(
    "https://github.com/settings/apps/new?state=x&y=<z>",
    JSON.stringify({ name: "Sylph <app>" })
  )

  expect(html).toContain('name="manifest"')
  expect(html).toContain(
    'value="{&quot;name&quot;:&quot;Sylph &lt;app&gt;&quot;}"'
  )
  expect(html).toContain(
    'action="https://github.com/settings/apps/new?state=x&amp;y=&lt;z&gt;"'
  )
  expect(html).not.toContain('"name"')
  expect(html).toContain("document.forms[0].submit()")
})

test("the callback only yields a code when the state matches", () => {
  const state = "expected"

  expect(
    callbackCode(
      new URL("http://127.0.0.1/callback?code=abc&state=expected"),
      state
    )
  ).toBe("abc")
  expect(
    callbackCode(
      new URL("http://127.0.0.1/callback?code=abc&state=other"),
      state
    )
  ).toBe("")
  expect(
    callbackCode(new URL("http://127.0.0.1/?code=abc&state=expected"), state)
  ).toBe("")
  expect(
    callbackCode(new URL("http://127.0.0.1/callback?state=expected"), state)
  ).toBe("")
})

test("the conversion response is validated", () => {
  const conversion = decodeConversion({
    id: 1,
    client_id: "Iv1.abc",
    client_secret: "secret",
    html_url: "https://github.com/apps/sylph-example",
    slug: "sylph-example",
    pem: "-----BEGIN RSA PRIVATE KEY-----",
  })

  expect(conversion.client_id).toBe("Iv1.abc")
  expect(() => decodeConversion({ client_id: "Iv1.abc" })).toThrow()
})
