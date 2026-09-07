import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  installationSetupRequest,
  getInstallationSetupStatus,
  type SetupBindings,
} from "./installation-setup"
import {
  readInstallationGithub,
  type InstallationDatabase,
} from "./installation-github"

const origin = "https://sylph.example.com"
const code = "a-long-private-setup-code-for-this-test"
const fixture = () => {
  const sqlite = new Database(":memory:")
  sqlite.exec(
    readFileSync(
      new URL(
        "../../../../packages/db/migrations/0001_initial.sql",
        import.meta.url
      ),
      "utf8"
    )
  )
  const statement = (
    query: string,
    values: (string | number | null)[] = []
  ) => ({
    bind: (...parameters: (string | number | null)[]) =>
      statement(query, parameters),
    first: async <Result>() =>
      sqlite.query<Result, (string | number | null)[]>(query).get(...values),
    run: async () => ({
      meta: { changes: sqlite.query(query).run(...values).changes },
    }),
  })
  const database: InstallationDatabase = { prepare: statement }
  const bindings: SetupBindings = {
    DB: database,
    SYLPH_URL: origin,
    INSTALLATION_CLAIM_SECRET: code,
    CREDENTIAL_ENCRYPTION_KEY: "test-encryption-key",
    GITHUB_CLIENT_ID: "",
    GITHUB_CLIENT_SECRET: "",
  }
  const request = (
    action: string,
    body?: Record<string, string>,
    cookie = "",
    source = origin
  ) =>
    new Request(`${origin}/api/setup/${action}`, {
      method: body ? "POST" : "GET",
      headers: { origin: source, cookie, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    })
  const unlock = async () => {
    const response = await installationSetupRequest(
      request("unlock", { code }),
      bindings
    )
    expect(response.status).toBe(200)
    const cookie = response.headers.get("set-cookie") ?? ""
    expect(cookie).toContain("HttpOnly; SameSite=Lax")
    expect(cookie).toContain("Secure")
    return cookie.split(";")[0]
  }
  return { sqlite, bindings, request, unlock }
}

test("setup requires the code, same origin, and a live session before saving credentials", async () => {
  const f = fixture()
  try {
    expect(
      (
        await installationSetupRequest(
          f.request("unlock", {
            code: "wrong-code-that-is-long-enough-for-validation",
          }),
          f.bindings
        )
      ).status
    ).toBe(403)
    expect(
      (
        await installationSetupRequest(
          f.request("unlock", { code }, "", "https://attacker.example"),
          f.bindings
        )
      ).status
    ).toBe(403)
    const app = {
      clientId: "client",
      clientSecret: "secret",
      appUrl: "https://github.com/apps/sylph-test",
    }
    expect(
      (
        await installationSetupRequest(
          f.request("github-existing", app),
          f.bindings
        )
      ).status
    ).toBe(401)
    const cookie = await f.unlock()
    expect(
      (
        await installationSetupRequest(
          f.request("github-existing", app, cookie),
          f.bindings
        )
      ).status
    ).toBe(200)
    expect(await readInstallationGithub(f.bindings)).toEqual(app)
    expect(
      JSON.stringify(
        f.sqlite.query("SELECT * FROM installation_github_app").all()
      )
    ).not.toContain('"secret"')
    const publicStatus = await getInstallationSetupStatus(
      f.request("status"),
      f.bindings
    )
    expect(publicStatus).toMatchObject({
      unlocked: false,
      githubConnected: true,
      appUrl: "",
    })
    f.sqlite.exec("UPDATE installation_setup_session SET expires_at = 0")
    expect(
      (
        await installationSetupRequest(
          f.request("github-existing", app, cookie),
          f.bindings
        )
      ).status
    ).toBe(401)
  } finally {
    f.sqlite.close()
  }
})

test("GitHub manifest callbacks bind to the browser session and are consumed once", async () => {
  const f = fixture()
  try {
    const cookie = await f.unlock()
    const form = new FormData()
    form.set("name", "My Sylph")
    const response = await installationSetupRequest(
      new Request(`${origin}/api/setup/github`, {
        method: "POST",
        headers: { origin, cookie },
        body: form,
      }),
      f.bindings
    )
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain(`${origin}/api/auth/callback/github`)
    const state = html.match(/state=([a-f0-9]+)/)?.[1]
    expect(state).toBeDefined()
    let conversions = 0
    const github = async () => {
      conversions += 1
      return Response.json({
        client_id: "client",
        client_secret: "secret",
        html_url: "https://github.com/apps/sylph-test",
        slug: "sylph-test",
      })
    }
    const callback = `github-callback?state=${state}&code=github-code`
    expect(
      (await installationSetupRequest(f.request(callback), f.bindings, github))
        .status
    ).toBe(401)
    expect(
      (
        await installationSetupRequest(
          f.request(
            "github-callback?state=wrong&code=github-code",
            undefined,
            cookie
          ),
          f.bindings,
          github
        )
      ).status
    ).toBe(403)
    expect(
      (
        await installationSetupRequest(
          f.request(callback, undefined, cookie),
          f.bindings,
          github
        )
      ).status
    ).toBe(303)
    expect(
      (
        await installationSetupRequest(
          f.request(callback, undefined, cookie),
          f.bindings,
          github
        )
      ).status
    ).toBe(403)
    expect(conversions).toBe(1)
  } finally {
    f.sqlite.close()
  }
})

test("claiming the Installation disables setup even with a previously valid cookie and code", async () => {
  const f = fixture()
  try {
    const cookie = await f.unlock()
    f.sqlite.exec("UPDATE installation SET claimed_by_user_id = 'owner'")
    expect(
      (
        await installationSetupRequest(
          f.request("unlock", { code }),
          f.bindings
        )
      ).status
    ).toBe(403)
    expect(
      (
        await installationSetupRequest(
          f.request(
            "github-existing",
            { clientId: "attacker", clientSecret: "secret", appUrl: "" },
            cookie
          ),
          f.bindings
        )
      ).status
    ).toBe(403)
    expect(
      (
        await getInstallationSetupStatus(
          f.request("status", undefined, cookie),
          f.bindings
        )
      ).unlocked
    ).toBe(false)
  } finally {
    f.sqlite.close()
  }
})

test("an interrupted GitHub conversion preserves setup and renders a retry path", async () => {
  const f = fixture()
  try {
    const cookie = await f.unlock()
    const form = new FormData()
    form.set("name", "My Sylph")
    const begin = await installationSetupRequest(
      new Request(`${origin}/api/setup/github`, {
        method: "POST",
        headers: { origin, cookie },
        body: form,
      }),
      f.bindings
    )
    const state = (await begin.text()).match(/state=([a-f0-9]+)/)?.[1]
    const callback = new Request(
      `${origin}/api/setup/github-callback?state=${state}&code=code`,
      { headers: { cookie, accept: "text/html" } }
    )
    const failure = await installationSetupRequest(
      callback,
      f.bindings,
      async () => new Response(null, { status: 503 })
    )
    expect(failure.status).toBe(502)
    expect(await failure.text()).toContain("Return to setup")
    expect(
      (
        await getInstallationSetupStatus(
          f.request("status", undefined, cookie),
          f.bindings
        )
      ).unlocked
    ).toBe(true)
    expect((await readInstallationGithub(f.bindings)).clientId).toBe("")
  } finally {
    f.sqlite.close()
  }
})
