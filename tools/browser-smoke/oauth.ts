interface Bindings {
  DB: D1Database
  SMOKE_TOKEN: string
}

const page = (body: string) =>
  new Response(
    `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>External authentication fixture</title><body>${body}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  )

export default {
  async fetch(request: Request, env: Bindings) {
    const url = new URL(request.url)
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS oauth_visits (id INTEGER PRIMARY KEY, visited INTEGER NOT NULL)"
    ).run()
    if (url.pathname === "/probe/count") {
      if (request.headers.get("authorization") !== `Bearer ${env.SMOKE_TOKEN}`)
        return new Response("Unauthorized", { status: 401 })
      return Response.json(
        await env.DB.prepare(
          "SELECT count(*) AS count FROM oauth_visits"
        ).first()
      )
    }
    await env.DB.prepare("INSERT INTO oauth_visits (visited) VALUES (1)").run()
    if (url.pathname === "/blocked")
      return page("<p>This origin was not allowed.</p>")
    if (url.pathname === "/login" && request.method === "POST") {
      const form = await request.formData()
      if (form.get("password") !== env.SMOKE_TOKEN)
        return new Response("Incorrect fixture password", { status: 403 })
      return new Response(null, {
        status: 303,
        headers: {
          location: "/",
          "set-cookie": `oauth-smoke=${env.SMOKE_TOKEN}; HttpOnly; Secure; SameSite=Lax; Path=/`,
        },
      })
    }
    if (
      request.headers
        .get("cookie")
        ?.split("; ")
        .includes(`oauth-smoke=${env.SMOKE_TOKEN}`)
    )
      return page('<p id="external-signed-in">External sign-in retained</p>')
    return page(
      '<form method="post" action="/login"><label>Fixture password <input type="password" name="password" id="external-password"></label><button id="external-sign-in">Sign in</button></form>'
    )
  },
} satisfies ExportedHandler<Bindings>
