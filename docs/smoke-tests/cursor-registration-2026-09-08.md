# Cursor provider registration verification — 2026-09-08

PR #75 fixes Cursor registration inside OpenCode and now uses a minimal bridge to the unmodified upstream provider. The sections below record earlier results; the latest continuation is at the end. Full live E2E remains unverified.

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

## Minimal bridge continuation

The user chose to retain OpenCode in the Durable Object. The Node container hosts only the unmodified `cursor-opencode-provider@0.6.6` model transport. OpenCode retains conversations, tool execution, permission checks, and durable session recovery.

Implementation `b1ee2f3d140ca41bb954898878db602eaf81ee04` imports `modelsToConfig` from the supported `cursor-opencode-provider/plugin` entrypoint. The bridge translates its output into OpenCode catalog fields, preserving wire model ids, model defaults, variants, output limits, and image support. Sylph's Max Mode inference and special Max Mode retry were deleted. Provider retries use upstream defaults. The remaining read-envelope and file-path translations adapt the pinned OpenCode tool API; no dependency internals are copied or patched.

Focused bridge tests passed, web and provider typechecks passed, and lint passed. The Workerd regression passed with deterministic Cursor inference before and after restart. This is transport and recovery proof, not a live Cursor service result.

Deployment of `b1ee2f3d140ca41bb954898878db602eaf81ee04` matched the source identity. Container application version 8 used digest `sha256:c68241b4140cdff929e942065fe5b513ba925db7f624ee3cef1aabbd3ac0e3fd`. A read-only `package.json` prompt through the authenticated in-app browser still returned `invalid_argument`. The next implementation uses upstream's public terminal-error formatter to preserve the rejection explanation while preventing unsafe host retries.

Temporary container log collection was disabled and verified in Cloudflare configuration. The four earlier repair files were saved to checkpoint `58cc926f7fedfb9e6621b33e7718fb340fdd3af5`. Check `check-3608eab7-618d-46c6-b160-7ac9a70e61ea`, attempt 1, failed with an internal Cloudflare Workflow error. The existing Project, both Workspaces, and Cursor connection remain preserved. No application release, restore, undo, or cleanup was performed.

The error-formatting implementation `616c8ce66b465eb375e692eac862b497292dfe2c` deployed successfully. Container version 9 used digest `sha256:80a8bdfd8b3bbddc738d26117e12070c1accdfea3cdcf1be3576838f1623ef4e`, with log collection disabled. The in-app model picker exposed the upstream Low, Medium, High, and Extra High variants after catalog refresh. A read-only prompt still failed with `Cursor API error (code=invalid_argument)`. Inspection of the unmodified provider's Connect error handling confirmed it intentionally constructs that generic message from the code without retaining the server message. No authentication rejection was observed.

CI passed on the main minimal-bridge commit `b1ee2f3d140ca41bb954898878db602eaf81ee04`: https://github.com/kcc989/sylph/actions/runs/34280344206. The error-formatting follow-up has focused tests, provider typecheck, and lint passing; check its newer CI run separately. The integration reduction is implemented, but live inference and the remaining full lifecycle still need verification. Preserve the fixture and investigate the upstream protocol failure using supported diagnostics rather than adding protocol patches or another model orchestration layer.

## Direct local reproduction

`tools/cursor-smoke/run.mjs` now reproduces the error directly through the unmodified provider, without the Sylph bridge, OpenCode, Workerd, or Cloudflare. On Node v24.16.0 with Cursor provider 0.6.6 and grok-4.6, both a standalone text request and a package.json read-tool request returned `invalid_argument`. Browser OAuth and model discovery succeeded. Node's read-only HTTP/2 diagnostic observer saw the incoming Connect error message `Error` in both cases. Credentials stayed in process memory and the only workspace was a synthetic temporary package fixture. The deployed fixture was not changed.

The failure therefore does not require the Sylph bridge. The exact provider/model/account/backend cause remains unresolved. See the local probe README for the reproduction command and important session-header behavior.

## Max Mode control experiment

The local same-login comparison with provider 0.6.6 and client version cli-2026.09.02-c22c1a3 rejected text with Max Mode false, then passed exact text and a real fixture read with Max Mode true. This isolates a usable public provider option; the account plan itself is not confirmed. The catalog now exposes an explicit Max variant for supported base models without overriding exact upstream variant parameters. Live deployment verification follows; local success alone does not complete the E2E.

## Live Max Mode verification

Deployed source `c9e712b125ff9be33adad0d1395eca6735a9a1a5` to the preserved stage. Exact Cloudflare application read confirmed version 11, image digest `efb56ee979510fa8f47c5c61b1f3713587e2e627b653f8030244030e4fee230c`, with container logs disabled. The application list lagged behind the exact application read.

Selected Cursor Grok 4.6 > Max in the in-app model picker. The existing Conversation completed `read /workspace/package.json` and returned `sylph-tanstack-template`. A second Turn wrote `cursor-unpatched-proof.txt`, edited `CURSOR_MAX_WRITE_OK` to `CURSOR_MAX_EDIT_OK`, read it, and ran OpenCode shell. Expanded tool output confirmed the marker, package name, and exit code 0. Cursor's initial native Shell attempts reported unavailable `bash`; it recovered through the exposed OpenCode `shell` tool. This limitation remains distinct from the resolved inference rejection.

The proof file is the only added working change. Existing fixture files remain preserved. All four PR CI checks passed for c9e712b. Checks were requested next; preview and release lifecycle are not proven by these provider results.

## Check and repair follow-through

Checkpoint `abf76d5d-1d67-4582-b26a-5ab2f82010b9`, commit `d4db629e65cf8c86c609d18a8a9b2e149b2ea8d3`, Check `check-abf76d5d-1d67-4582-b26a-5ab2f82010b9` passed install, typecheck, lint, test, and build. Preview failed with `ResourcePolicyError: Recovery control must use a separate D1 database`. The exact source condition is a non-D1 resource with purpose recovery_control, not equal database IDs.

Cursor's automatic repair turn inspected files and changed two resource-plan files. Follow-up guidance supplied the exact validation condition, then requested a checkpoint and rerun without publish/restore/deletion. That checkpoint/rerun was not confirmed: the Workspace became unavailable. Scoped Worker telemetry reported the Durable Object exceeded its memory limit and reset, followed by repeated blockConcurrencyWhile startup timeouts. Retry and reload did not establish recovery. Preserve the existing Workspace, its saved repair edits, and the Check above. Do not claim Preview, release, or recovery E2E success from the successful provider probes.
