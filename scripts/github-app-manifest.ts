import {
  callbackCode,
  conversionUrl,
  creationUrl,
  decodeConversion,
  manifestFor,
  manifestFormHtml,
  type Conversion,
} from "../tools/wizard/github-app-manifest"

const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}

const required = (name: string) => {
  const value = Bun.env[name] ?? ""
  return value === "" ? fail(`${name} is required`) : value
}

const sylphUrl = required("SYLPH_URL").replace(/\/+$/, "")
const name = required("SYLPH_GITHUB_APP_NAME")
const owner = Bun.env.SYLPH_GITHUB_APP_OWNER ?? ""
const state = crypto.randomUUID()
const timeoutMilliseconds = 10 * 60 * 1000

const { promise, resolve, reject } = Promise.withResolvers<Conversion>()

const html = (body: string, status: number) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  })

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === "/") {
      const manifest = manifestFor({
        name,
        sylphUrl,
        redirectUrl: `http://127.0.0.1:${server.port}/callback`,
      })
      return html(
        manifestFormHtml(creationUrl(owner, state), JSON.stringify(manifest)),
        200
      )
    }

    const code = callbackCode(url, state)
    if (code === "") {
      return html("<p>Not found.</p>", 404)
    }

    const response = await fetch(conversionUrl(code), {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "sylph-setup",
      },
    })

    if (!response.ok) {
      reject(
        new Error(
          `GitHub returned HTTP ${response.status} while converting the manifest`
        )
      )
      return html(
        "<p>GitHub rejected the manifest code. Return to the terminal.</p>",
        502
      )
    }

    resolve(decodeConversion(await response.json()))
    return html(
      "<p>Sylph received the GitHub App credentials. You can close this tab and return to the terminal.</p>",
      200
    )
  },
})

const startUrl = `http://127.0.0.1:${server.port}/`
const opener = ["open", "xdg-open", "wslview"].find(
  (command) => Bun.which(command) !== null
)

console.error(`Opening ${startUrl}`)
if (opener === undefined) {
  console.error("No browser opener was found. Open the URL above yourself.")
} else {
  Bun.spawn([opener, startUrl], { stdout: "ignore", stderr: "ignore" })
}

const timer = setTimeout(
  () => reject(new Error("Timed out waiting for GitHub to create the App")),
  timeoutMilliseconds
)

try {
  const conversion = await promise
  console.log(
    JSON.stringify({
      clientId: conversion.client_id,
      clientSecret: conversion.client_secret,
      htmlUrl: conversion.html_url,
      slug: conversion.slug,
    })
  )
} catch (cause) {
  fail(cause instanceof Error ? cause.message : String(cause))
} finally {
  clearTimeout(timer)
  server.stop(true)
}
