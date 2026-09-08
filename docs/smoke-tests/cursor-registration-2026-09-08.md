# Cursor provider registration verification — 2026-09-08

PR #75 fixes Cursor registration inside OpenCode. The deployed implementation is `78311f6b1a8f963c22c744e59132eab7cb210594`. Live model inference remains blocked by a subsequent HTTP 500 from the container proxy.

## Source and retained fixture

- Stage: `smoke-lifecycle-01a07d89`
- Installation: https://sylph-website-smoke-lifecycle-z2jjjljweyxee7ezdk4z52yj.apingot.workers.dev
- Template: `33482d3892652237dccfb80a9d2f4e479a6d51e0`
- Project: `746920b9-d33b-44a9-a3ec-61b75a505f74`
- Workspace: `39d83a6c-70a5-43ec-a23a-48f09eee1822`
- Provider/model: personal Cursor / `grok-4.6`
- Continuation checkout: `/private/tmp/sylph-remaining-01a07d89/integration`
- Branch: `codex/verify-unpatched-cursor`

The existing authenticated in-app browser session worked. No new Cursor login was requested. Both Workspaces and the four pending fixture repair edits were preserved. No application release, restore, undo, or cleanup was performed.

## Observed results

1. PR #74 merged as `57cec7796e4bfbe2fd1246e5888d2f8ba5de676b`. Deployment to the retained stage succeeded, and the identity endpoint matched source, template, and stage.
2. Cloudflare settings confirmed `CURSOR_RUNTIME` bound to `CursorRuntimeContainer`, namespace `173a08e8382c4af78f2ef6035e420146`. Container application `a033b7b4-322b-4024-ba03-44da08bffd23` uses image digest `sha256:a7f41b3fdc4f35915a5d39f81be3d72dbc94938ccc4e3a3ec53a367c5f528e98`.
3. A bounded in-app browser prompt failed before tools with `Unsupported package for cursor/grok-4.6: aisdk:sylph-cursor`. OpenCode's dynamic package loader ran before the registered Cursor SDK hook.
4. Sylph now uses the public ConfigPluginSource service to remove `opencode.provider.dynamic` from its Workerd host. The default Workerd profile already disables filesystem plugin discovery. No dependency was modified. OpenCode still owns model invocation, sessions, tools, permissions, and cancellation.
5. The Workerd regression now executes Cursor inference through the actual registered adapter with a deterministic transport response before and after a Durable Object restart. It passes along with typecheck, lint, formatting, focused adapter tests, and all PR CI jobs: https://github.com/kcc989/sylph/actions/runs/34273574095.
6. Deployment of `78311f6b1a8f963c22c744e59132eab7cb210594` succeeded and matched the identity endpoint. Live requests no longer fail package resolution. Two in-app browser attempts instead produced `Cursor provider request failed (500)` before tool results. Worker version `996b9b0a-3a7b-4dd6-ae4f-b2687ead7e15` recorded HTTP 500 at `CursorRuntimeContainer`. One earlier alarm recorded a code-update reset; a retry after deployment settled still failed. No authentication-specific rejection was observed.

## Next verification

Inspect the container proxy's actual error response and startup behavior. The current language-model adapter exposes only the status. The container HTTP server uses 502 for its own caught handler failures; the Cloudflare Container proxy can produce 500 during startup or proxying. This narrows the investigation but does not establish the cause. The scoped container telemetry query returned no container log events.

Retain the existing Cursor connection. Ask the user to log in only when authentication is actually required. Then repeat file read/write, shell execution, checkpoint/Check, continuation, cancellation, and session isolation in the in-app browser. None of those operations has passed on this unpatched live implementation yet.

The earlier missing `/workspace/package.json` is no longer the latest observed Check failure: Check `check-05f31f23-e032-4def-8973-4c96fce5822c`, attempt 2, checkpoint `cc7c5b881ce52e65640208933c50ec2b6a20d10f`, passed installation and failed typecheck because fixture mocks omitted `FILES` and used invalid R2 types. The agent repaired four files before this continuation, but its Check enqueue returned HTTP 500. Those edits remain pending. No newer Check was created during the blocked Cursor verification.

Private logs, deployment snapshots, previous run-record backups, and telemetry are under `/private/tmp/sylph-remaining-01a07d89`. Keep them private. The original lifecycle handoff remains applicable after this registration update; the complete E2E journey is still unverified.
