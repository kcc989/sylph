import {
  InstallationGithubApp,
  InstallationGithubManifest,
  InstallationSetupFailure,
  InstallationSetupUnlock,
} from "@workspace/domain"
import { Schema } from "effect"
import {
  conversionUrl,
  creationUrl,
  decodeConversion,
  manifestFor,
  manifestFormHtml,
} from "../../../../tools/wizard/github-app-manifest"
import { installationOrigin } from "./installation-address"
import {
  readInstallationGithub,
  saveInstallationGithub,
  type InstallationGithubBindings,
} from "./installation-github"
import { secretsMatch } from "./secret-comparison"

export type SetupBindings = InstallationGithubBindings & {
  INSTALLATION_CLAIM_SECRET: string
  SYLPH_URL: string
}

const reject = (message: string, status = 400): never => {
  throw new InstallationSetupFailure({ message, status })
}
const digest = async (value: string) => {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  )
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}
const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
const now = () => Math.floor(Date.now() / 1000)
const setupCookie = (request: Request) =>
  request.headers
    .get("cookie")
    ?.split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith("sylph_setup="))
    ?.slice("sylph_setup=".length) ?? ""

const installationClaimed = async (bindings: SetupBindings) => {
  const row = await bindings.DB.prepare(
    "SELECT claimed_by_user_id FROM installation WHERE id = 'default'"
  ).first<{ claimed_by_user_id: string | null }>()
  if (!row)
    return reject(
      "Installation storage is not ready. Retry the deployment.",
      503
    )
  return Boolean(row.claimed_by_user_id)
}

export const setupSessionId = async (
  request: Request,
  bindings: SetupBindings
) => {
  const token = setupCookie(request)
  if (!token || (await installationClaimed(bindings))) return null
  const id = await digest(token)
  const row = await bindings.DB.prepare(
    "SELECT id FROM installation_setup_session WHERE id = ? AND expires_at > ?"
  )
    .bind(id, now())
    .first<{ id: string }>()
  return row?.id ?? null
}

export const getInstallationSetupStatus = async (
  request: Request,
  bindings: SetupBindings
) => {
  const [claimed, sessionId, github] = await Promise.all([
    installationClaimed(bindings),
    setupSessionId(request, bindings),
    readInstallationGithub(bindings),
  ])
  return {
    claimed,
    unlocked: Boolean(sessionId),
    githubConnected: Boolean(github.clientId && github.clientSecret),
    appUrl: sessionId ? github.appUrl : "",
    origin: installationOrigin(request, bindings.SYLPH_URL),
  }
}

const githubAppUrl = (value: string) => {
  if (!value) return ""
  const url = new URL(value)
  if (
    url.origin !== "https://github.com" ||
    !/^\/apps\/[a-zA-Z0-9-]+\/?$/.test(url.pathname) ||
    url.search ||
    url.hash
  )
    return reject(
      "Enter the GitHub App's public URL, such as https://github.com/apps/my-sylph"
    )
  return url.href.replace(/\/$/, "")
}

export const installationSetupRequest = async (
  request: Request,
  bindings: SetupBindings,
  githubFetch: (url: string, init?: RequestInit) => Promise<Response> = fetch
) => {
  const headers = {
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  }
  try {
    const url = new URL(request.url)
    const origin = installationOrigin(request, bindings.SYLPH_URL)
    const action = url.pathname.slice("/api/setup/".length)
    if (url.origin !== origin)
      return reject("Open setup at the Installation's primary address", 421)
    if (request.method === "GET" && action === "status")
      return Response.json(
        await getInstallationSetupStatus(request, bindings),
        { headers }
      )
    if (request.method === "POST" && request.headers.get("origin") !== origin)
      return reject("Open setup at the Installation's primary address", 403)
    if (await installationClaimed(bindings))
      return reject("This Installation has already been claimed", 403)
    if (request.method === "POST" && action === "unlock") {
      const input = Schema.decodeUnknownSync(InstallationSetupUnlock)(
        await request.json()
      )
      if (
        !bindings.INSTALLATION_CLAIM_SECRET ||
        !(await secretsMatch(input.code, bindings.INSTALLATION_CLAIM_SECRET))
      )
        return reject(
          "The setup code is incorrect. Use the code saved for this deployment.",
          403
        )
      const token = randomToken()
      await bindings.DB.prepare(
        "DELETE FROM installation_setup_session WHERE expires_at <= ?"
      )
        .bind(now())
        .run()
      await bindings.DB.prepare(
        "INSERT INTO installation_setup_session (id, expires_at) VALUES (?, ?)"
      )
        .bind(await digest(token), now() + 3600)
        .run()
      const secure = origin.startsWith("https:") ? "; Secure" : ""
      return Response.json(
        { unlocked: true },
        {
          headers: {
            ...headers,
            "set-cookie": `sylph_setup=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600${secure}`,
          },
        }
      )
    }
    const sessionId = await setupSessionId(request, bindings)
    if (!sessionId)
      return reject("Unlock setup again with your setup code", 401)
    if (request.method === "POST" && action === "github") {
      const form = await request.formData()
      const input = Schema.decodeUnknownSync(InstallationGithubManifest)({
        name: form.get("name"),
        owner: form.get("owner") ?? "",
      })
      if (input.owner && !/^[a-zA-Z0-9-]+$/.test(input.owner))
        return reject("Enter the GitHub organization name without a URL")
      const state = randomToken()
      await bindings.DB.prepare(
        "UPDATE installation_setup_session SET github_state = ?, github_origin = ? WHERE id = ?"
      )
        .bind(await digest(state), origin, sessionId)
        .run()
      const manifest = manifestFor({
        name: input.name,
        sylphUrl: origin,
        redirectUrl: `${origin}/api/setup/github-callback`,
      })
      return new Response(
        manifestFormHtml(
          creationUrl(input.owner, state),
          JSON.stringify(manifest)
        ),
        { headers: { ...headers, "content-type": "text/html; charset=utf-8" } }
      )
    }
    if (request.method === "GET" && action === "github-callback") {
      const state = url.searchParams.get("state") ?? ""
      const code = url.searchParams.get("code") ?? ""
      if (!state || !code)
        return reject("GitHub setup was cancelled. Return to setup and retry.")
      const consumed = await bindings.DB.prepare(
        "UPDATE installation_setup_session SET github_state = NULL, github_origin = NULL WHERE id = ? AND github_state = ? AND github_origin = ? AND expires_at > ?"
      )
        .bind(sessionId, await digest(state), origin, now())
        .run()
      if (consumed.meta.changes !== 1)
        return reject(
          "This GitHub setup link expired or was already used. Return to setup and retry.",
          403
        )
      const response = await githubFetch(conversionUrl(code), {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "sylph-setup",
        },
      })
      if (!response.ok)
        return reject(
          "GitHub could not finish App setup. Return to setup and try again.",
          502
        )
      const converted = decodeConversion(await response.json())
      await saveInstallationGithub(
        bindings,
        new InstallationGithubApp({
          clientId: converted.client_id,
          clientSecret: converted.client_secret,
          appUrl: githubAppUrl(converted.html_url),
        })
      )
      return new Response(null, {
        status: 303,
        headers: { ...headers, location: `${origin}/setup` },
      })
    }
    if (request.method === "POST" && action === "github-existing") {
      const input = Schema.decodeUnknownSync(InstallationGithubApp)(
        await request.json()
      )
      await saveInstallationGithub(
        bindings,
        new InstallationGithubApp({
          ...input,
          appUrl: githubAppUrl(input.appUrl),
        })
      )
      return Response.json({ connected: true }, { headers })
    }
    return reject("Setup action not found", 404)
  } catch (cause) {
    const status =
      cause instanceof InstallationSetupFailure
        ? cause.status
        : Schema.isSchemaError(cause)
          ? 400
          : 500
    const message =
      cause instanceof InstallationSetupFailure
        ? cause.message
        : Schema.isSchemaError(cause)
          ? "Check the setup fields and try again"
          : "Setup could not finish. Your saved progress is kept; retry this step."
    if (request.headers.get("accept")?.includes("text/html")) {
      const escaped = message
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
      return new Response(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sylph setup</title></head><body style="font-family:system-ui;background:#171614;color:#eeeae4;padding:2rem"><main style="max-width:30rem;margin:10vh auto"><h1 style="font-size:1.25rem">Setup needs attention</h1><p style="line-height:1.6">${escaped}</p><p style="line-height:1.6">If GitHub already created the App, choose Connect an existing GitHub App when you return.</p><a style="color:#eeaa90" href="/setup">Return to setup</a></main></body></html>`,
        {
          status,
          headers: { ...headers, "content-type": "text/html; charset=utf-8" },
        }
      )
    }
    return Response.json({ message }, { status, headers })
  }
}
