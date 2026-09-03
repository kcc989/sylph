import { Schema } from "effect"

export type ManifestInput = {
  readonly name: string
  readonly sylphUrl: string
  readonly redirectUrl: string
}

export const manifestFor = (input: ManifestInput) => ({
  name: input.name,
  url: input.sylphUrl,
  redirect_url: input.redirectUrl,
  callback_urls: [`${input.sylphUrl}/api/auth/callback/github`],
  request_oauth_on_install: true,
  setup_on_update: false,
  public: false,
  hook_attributes: {
    url: `${input.sylphUrl}/api/github/webhook`,
    active: false,
  },
  default_permissions: {
    contents: "write",
    pull_requests: "write",
    emails: "read",
  },
  default_events: [],
})

export const creationUrl = (owner: string, state: string) =>
  owner === ""
    ? `https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`
    : `https://github.com/organizations/${encodeURIComponent(owner)}/settings/apps/new?state=${encodeURIComponent(state)}`

export const conversionUrl = (code: string) =>
  `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")

export const manifestFormHtml = (action: string, manifest: string) =>
  `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Create the Sylph GitHub App</title></head>
<body style="font-family: system-ui; margin: 3rem auto; max-width: 40rem">
<h1>Create the Sylph GitHub App</h1>
<p>GitHub opens with the App pre-configured. Review the settings and choose <strong>Create GitHub App</strong>.</p>
<form method="post" action="${escapeHtml(action)}">
<input type="hidden" name="manifest" value="${escapeHtml(manifest)}">
<button type="submit">Continue to GitHub</button>
</form>
<script>document.forms[0].submit()</script>
</body>
</html>`

export const Conversion = Schema.Struct({
  client_id: Schema.String,
  client_secret: Schema.String,
  html_url: Schema.String,
  slug: Schema.String,
})

export type Conversion = typeof Conversion.Type

export const decodeConversion = Schema.decodeUnknownSync(Conversion)

export const callbackCode = (url: URL, state: string) =>
  url.pathname === "/callback" && url.searchParams.get("state") === state
    ? (url.searchParams.get("code") ?? "")
    : ""
