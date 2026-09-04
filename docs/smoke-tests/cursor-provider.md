# Cursor subscription through OpenCode

Sylph registers a Cursor language-model provider in OpenCode 2. OpenCode still
owns the conversation, tool execution, permissions, and checkpoints. The adapter
forwards model requests and tool results to a private Node service in a
Cloudflare Container. That service uses `cursor-opencode-provider@0.6.6`.

The community provider uses Cursor's HTTP/2 transport. Workers do not implement
`node:http2.connect`, so the transport runs in a container. This integration does
not use the Cursor Agent SDK and is not an official Cursor API integration.

A pinned OpenCode patch runs the dynamic npm provider loader after bundled
provider hooks. Cursor uses the bundled adapter; existing native providers use
OpenCode's native provider mapping. Models are prepared before OpenCode lazily loads the plugin, and the
catalog transform itself remains synchronous.

## Credentials and isolation

Each Sylph user has a separate named Cursor Durable Object and container. The
Durable Object encrypts OAuth tokens and pending login state with AES-GCM, using
the existing `CREDENTIAL_ENCRYPTION_KEY`. The personal provider connection stores
an encrypted handle. OpenCode resolves that handle for each request; the bridge
checks it against the current connection before sending a request to Cursor.

The browser receives a PKCE login URL and status, never the OAuth tokens. Tokens
are passed to the private Node process for requests. The process keeps transient
provider state and caches on its ephemeral filesystem. Disconnect removes
stored credentials and destroys the container.

Alchemy configures the container and private cross-worker binding in
`alchemy.run.ts`. The existing Cloudflare registry and Containers access are
required. There is no public bridge route or separate bridge API key.

## Verification

1. Deploy an isolated Alchemy stage with the existing preview OAuth proxy
   configuration. The GitHub App must accept the proxy callback.
2. Sign into Sylph, claim the fresh Installation, and open User settings.
3. Select **Connect Cursor**, follow **Sign in to Cursor**, and finish login.
4. Confirm the personal connection and select a discovered Cursor model.
5. Create a Workspace and ask OpenCode to inspect a file, edit it, and run a
   check. Confirm tool events and the resulting checkpoint in Sylph.
6. Send a follow-up prompt to verify continuation after tool results.
7. Cancel an active turn and verify it stops. Reconnect, then disconnect and
   verify subsequent Cursor requests require a new connection.
8. Test a container restart separately. Persistent OpenCode history does not
   make Cursor's in-memory HTTP/2 continuation durable. An interrupted stream
   must fail rather than report a successful completion.

Run `bun run typecheck`, `bun run lint`, `bun run format:check`, and `bun run test`
for local validation. Stream tests cover tool results, compaction metadata,
session identity, cancellation signal forwarding, and truncated responses.
They do not prove live Cursor authentication, inference, or checkpoint recovery.

## Preview evidence: 2026-09-04

The `cursor-4595` Cloudflare stage passed personal Cursor login and model
discovery. Test magic-link login was disabled after claiming the Installation.
The live `cursor/default` model read `README.md`, then completed a follow-up turn
that requested write permission, wrote `cursor-smoke.txt`, read it back, and
called `workspace_checkpoint`.

- Workspace: `c1b4ef8d-b921-4b5b-b0eb-0e210d01d2ea`
- File content: `Cursor through OpenCode on Cloudflare.`
- Checkpoint: `d97b9b0a-3005-4e8e-9a77-8ff6894e421b`
- Commit: `479868b83fde1e4c184e9985e8ee6219d3ca1e60`

The checkpoint tool output and conversation persisted after browser reload.
This verifies model inference, tool-result continuation, permissions, file
mutation, and checkpoint creation. It does not verify automatic token refresh
at expiry, cancellation, disconnect, or recovery of an interrupted container.
The early fixed-interval refresh attempt failed; refresh is now scheduled from
the token's expiry, and that scheduling has unit coverage.

After rebasing onto current main, local checks passed: type checking, Oxlint,
Oxfmt, and all test tasks, including 249 web tests and both OpenCode runtime
regression tests. The live preview evidence above predates that rebase.
No Project deployment or merge was performed.
