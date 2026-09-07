import { browserJournal } from "../../apps/web/src/server/workspace-browser-journal"
import { DurableObject } from "cloudflare:workers"
import { Effect, Layer, ManagedRuntime, Schema } from "effect"
import {
  WorkspaceBrowserToolInput,
  BrowserPolicyInput,
  BrowserProofBinding,
  browserJourneyBlockers,
} from "@workspace/domain"

import { browserRunLayer } from "../../apps/web/src/server/browser-run"
import {
  durableBrowserSessionStore,
  WorkspaceBrowser,
  workspaceBrowserLayer,
} from "../../apps/web/src/server/workspace-browser-session"
import { newCheckRun } from "../../apps/web/src/server/workspace-checks"

interface Bindings {
  BROWSER: BrowserRun
  DB: D1Database
  EVIDENCE: R2Bucket
  SESSIONS: DurableObjectNamespace<BrowserSmoke>
  SMOKE_TOKEN: string
  SMOKE_COMMIT: string
  SMOKE_SOURCE: string
  SMOKE_OAUTH_ORIGIN: string
}

const decodeInput = Schema.decodeUnknownPromise(WorkspaceBrowserToolInput)
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)
const document = (commit: string, source: string, body: string) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Browser Run journey</title></head><body data-sylph-checkpoint="${commit}" data-sylph-deployment="preview" data-sylph-browser-source="${source}"><h1>Browser Run journey</h1>${body}</body></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    }
  )
const redirect = (origin: string) =>
  new Response(null, { status: 303, headers: { location: `${origin}/` } })

export class BrowserSmoke extends DurableObject<Bindings> {
  async fetch(request: Request) {
    const url = new URL(request.url)
    if (url.pathname === "/probe/trace")
      return Response.json((await this.ctx.storage.get("browser-trace")) ?? [])
    const phases: string[] = []
    const runtime = ManagedRuntime.make(
      workspaceBrowserLayer({
        storage: durableBrowserSessionStore(this.ctx.storage),
        journal: browserJournal(this.ctx.storage),
        async assertWritable() {},
        async reserveAcceptance() {
          throw new Error("Fixture does not merge")
        },
        saveEvidence: async (key, value, contentType) => {
          await this.env.EVIDENCE.put(key, value, {
            httpMetadata: { contentType },
          })
        },
        context: async () => {
          const stored = await this.ctx.storage.get("smoke-binding")
          const binding = stored
            ? Schema.decodeUnknownSync(BrowserProofBinding)(stored)
            : null
          return {
            run: newCheckRun({
              id: "browser-smoke-check",
              workspaceId: "browser-smoke",
              checkpointId: "browser-smoke-checkpoint",
              commit: binding?.commit ?? this.env.SMOKE_COMMIT,
              kind: "checkpoint",
              attempt: binding?.attempt ?? 1,
              createdAt: 1,
            }),
            previewUrl: url.origin,
            conversationId:
              binding?.conversationId ?? "browser-smoke-conversation",
          }
        },
        addEvidence: () => {},
      }).pipe(
        Layer.provide(
          browserRunLayer(this.env.BROWSER, async (phase) => {
            phases.push(phase)
            await this.ctx.storage.put("browser-trace", phases)
          })
        )
      )
    )
    try {
      if (url.pathname === "/probe/policy") {
        const policy = Schema.decodeUnknownSync(BrowserPolicyInput)(
          await request.json()
        )
        const current = await browserJournal(this.ctx.storage).policy()
        await runtime.runPromise(
          Effect.flatMap(WorkspaceBrowser, (browser) =>
            browser.configure(policy, current?.revision ?? 0, "smoke-user")
          )
        )
        return Response.json({ configured: true })
      }
      if (url.pathname === "/probe/proof") {
        const proof = await runtime.runPromise(
          Effect.flatMap(WorkspaceBrowser, (browser) => browser.snapshot())
        )
        return Response.json({
          proof,
          blockers: proof.binding
            ? browserJourneyBlockers(proof, proof.binding)
            : ["Missing binding"],
        })
      }
      if (url.pathname === "/probe/context") {
        await this.ctx.storage.put(
          "smoke-binding",
          Schema.decodeUnknownSync(BrowserProofBinding)(await request.json())
        )
        return Response.json({ changed: true })
      }
      const input = await decodeInput(await request.json())
      const result = await runtime.runPromise(
        Effect.flatMap(WorkspaceBrowser, (browser) =>
          browser.execute(
            input,
            url.pathname === "/probe/human"
              ? { userId: "smoke-user" }
              : undefined
          )
        )
      )
      return Response.json(result)
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 422 }
      )
    } finally {
      await runtime.dispose()
    }
  }
}

export default {
  async fetch(request: Request, env: Bindings) {
    const url = new URL(request.url)
    if (url.pathname.startsWith("/probe/")) {
      if (request.headers.get("authorization") !== `Bearer ${env.SMOKE_TOKEN}`)
        return new Response("Unauthorized", { status: 401 })
      if (url.pathname === "/probe/ready")
        return Response.json({
          commit: env.SMOKE_COMMIT,
          sourceHash: env.SMOKE_SOURCE,
          oauthOrigin: env.SMOKE_OAUTH_ORIGIN,
        })
      if (
        [
          "/probe/browser",
          "/probe/human",
          "/probe/policy",
          "/probe/proof",
          "/probe/context",
          "/probe/trace",
        ].includes(url.pathname)
      )
        return env.SESSIONS.get(env.SESSIONS.idFromName("journey")).fetch(
          request
        )
      if (url.pathname === "/probe/rows")
        return Response.json(
          await env.DB.prepare(
            "SELECT title, completed FROM todos ORDER BY id"
          ).all()
        )
      if (url.pathname.startsWith("/probe/evidence/")) {
        const evidence = await env.EVIDENCE.get(
          `browser-smoke/${url.pathname.slice("/probe/evidence/".length)}`
        )
        return evidence
          ? new Response(evidence.body, {
              headers: {
                "content-type":
                  evidence.httpMetadata?.contentType ??
                  "application/octet-stream",
              },
            })
          : new Response("Missing", { status: 404 })
      }
      return new Response("Missing", { status: 404 })
    }
    if (url.pathname === "/oauth/start") {
      const state = crypto.randomUUID()
      await env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS oauth_flows (state TEXT PRIMARY KEY, callback TEXT NOT NULL, code TEXT, consumed INTEGER NOT NULL DEFAULT 0)"
      ).run()
      await env.DB.prepare(
        "INSERT INTO oauth_flows (state, callback) VALUES (?, ?)"
      )
        .bind(state, `${url.origin}/oauth/callback`)
        .run()
      return new Response(null, {
        status: 303,
        headers: {
          location: `${env.SMOKE_OAUTH_ORIGIN}/?state=${state}`,
          "set-cookie": `oauth-state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/`,
        },
      })
    }
    if (url.pathname === "/oauth/callback") {
      const state = url.searchParams.get("state") ?? ""
      const code = url.searchParams.get("code") ?? ""
      if (
        !request.headers
          .get("cookie")
          ?.split("; ")
          .includes(`oauth-state=${state}`)
      )
        return new Response("OAuth state mismatch", { status: 403 })
      const consumed = await env.DB.prepare(
        "UPDATE oauth_flows SET consumed = 1 WHERE state = ? AND code = ? AND consumed = 0"
      )
        .bind(state, code)
        .run()
      if (consumed.meta.changes !== 1)
        return new Response("OAuth code invalid or already consumed", {
          status: 403,
        })
      return new Response(null, {
        status: 303,
        headers: {
          location: "/",
          "set-cookie":
            "oauth-complete=true; HttpOnly; Secure; SameSite=Lax; Path=/",
        },
      })
    }
    if (url.pathname === "/login" && request.method === "POST") {
      const form = await request.formData()
      if (form.get("password") !== env.SMOKE_TOKEN)
        return new Response("Incorrect fixture password", { status: 403 })
      return new Response(null, {
        status: 303,
        headers: {
          location: `${url.origin}/`,
          "set-cookie": `browser-smoke=${env.SMOKE_TOKEN}; HttpOnly; Secure; SameSite=Lax; Path=/`,
        },
      })
    }
    if (
      !request.headers
        .get("cookie")
        ?.split("; ")
        .includes(`browser-smoke=${env.SMOKE_TOKEN}`)
    ) {
      return document(
        env.SMOKE_COMMIT,
        env.SMOKE_SOURCE,
        `<form method="post" action="/login"><label>Password <input id="password" name="password" type="password"></label><button id="login">Sign in</button></form><a id="external-popup" target="_blank" href="${env.SMOKE_OAUTH_ORIGIN}/blocked">Open external popup</a>`
      )
    }
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS todos (id INTEGER PRIMARY KEY, title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0)"
    ).run()
    if (request.method === "POST") {
      const form = await request.formData()
      const title = String(form.get("title") ?? "").slice(0, 200)
      if (url.pathname === "/create")
        await env.DB.prepare("INSERT INTO todos (title) VALUES (?)")
          .bind(title)
          .run()
      else if (url.pathname === "/edit")
        await env.DB.prepare("UPDATE todos SET title = ? WHERE id = ?")
          .bind(title, Number(form.get("id")))
          .run()
      else if (url.pathname === "/complete")
        await env.DB.prepare("UPDATE todos SET completed = 1 WHERE id = ?")
          .bind(Number(form.get("id")))
          .run()
      else if (url.pathname === "/delete")
        await env.DB.prepare("DELETE FROM todos WHERE id = ?")
          .bind(Number(form.get("id")))
          .run()
      return redirect(url.origin)
    }
    const rows = await env.DB.prepare(
      "SELECT id, title, completed FROM todos ORDER BY id"
    ).all<{ id: number; title: string; completed: number }>()
    return document(
      env.SMOKE_COMMIT,
      env.SMOKE_SOURCE,
      `<p id="signed-in">Signed in</p>${request.headers.get("cookie")?.includes("oauth-complete=true") ? '<p id="oauth-authenticated">OAuth callback completed</p>' : ""}<label>View <select id="view" onchange="localStorage.setItem('view',this.value)"><option value="all">All</option><option value="active">Active</option></select></label><script>document.querySelector('#view').value=localStorage.getItem('view')||'all'</script><form method="post" action="/create"><label>Todo <input id="title" name="title" required></label><button id="create">Create</button></form><ul>${rows.results.map((row) => `<li class="todo"><span class="title">${escapeHtml(row.title)}</span><input class="completed" type="checkbox" ${row.completed ? "checked" : ""} disabled><form method="post" action="/edit"><input type="hidden" name="id" value="${row.id}"><input id="edit-title" name="title" value="${escapeHtml(row.title)}"><button id="edit">Save</button></form><form method="post" action="/complete"><input type="hidden" name="id" value="${row.id}"><button id="complete">Complete</button></form><form method="post" action="/delete"><input type="hidden" name="id" value="${row.id}"><button id="delete">Delete</button></form></li>`).join("")}</ul><a id="external" href="https://example.com">External navigation</a><a id="oauth-popup" target="_blank" href="/oauth/start">External authentication</a>`
    )
  },
} satisfies ExportedHandler<Bindings>
