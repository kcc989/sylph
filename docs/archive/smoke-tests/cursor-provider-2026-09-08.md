# Cursor subscription through OpenCode

> Historical record for the source and date below. Status, URLs, and commands may be outdated; recorded approvals do not authorize new actions. Use [current documentation](../../README.md).

For current deployed verification status and continuation steps, read the
[E2E handoff](e2e-handoff-2026-09-08.md).

Sylph registers `cursor-opencode-provider@0.6.6` through its public provider API.
The unmodified provider runs in a Node 24 Cloudflare Container. OpenCode runs in
the Workspace Durable Object and owns conversation history, tools, permissions,
and checkpoints. This community provider is not the official Cursor Agent SDK.

Alchemy declares the private `CURSOR_RUNTIME` binding in `alchemy.run.ts`.
Container identities include the user Durable Object, connection generation,
and OpenCode session. Authentication operations use a separate container.
Each stream receives a current Workspace file snapshot at `/workspace` for the
provider's native file checks. Unsafe paths are rejected, stale files are
removed, and overlapping requests are rejected before replacing the snapshot.
Tool execution remains in Sylph's Workspace and Cloudflare CI services.

## Credentials and isolation

The per-user Cursor Durable Object encrypts OAuth tokens and pending login state
with AES-GCM using `CREDENTIAL_ENCRYPTION_KEY`. The personal provider connection
stores an encrypted handle. Each request must match the current connection.
Tokens travel only over the private container binding; the browser receives a
PKCE URL and status. Tokens are not included in the image or its environment.

Disconnect deletes the stored connection and prevents further authenticated
requests. Reconnecting uses a new container identity. An already running stream
must be cancelled separately. Idle containers sleep after ten minutes; their
local files and continuation state are ephemeral. OpenCode history remains
in Durable Object storage. No dependency patches or custom HTTP/2 implementation
are used.

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
8. Test a Durable Object restart separately. Persistent OpenCode history does not
   make Cursor's in-memory continuation durable. An interrupted stream
   must fail rather than report a successful completion.

Run `bun run typecheck`, `bun run lint`, `bun run format:check`, and `bun run test`
for local validation. Stream tests cover tool results, compaction metadata,
session identity, cancellation signal forwarding, and truncated responses.
They do not prove live Cursor authentication, inference, or checkpoint recovery.

## Current local verification: 2026-09-08

The application build, full tests, typecheck, lint, and formatting pass. The
Docker image builds using a frozen lockfile and unmodified dependencies. Its
Node service returns a PKCE login response and rejects unknown routes.
Focused tests cover stream forwarding, cancellation, concurrent requests,
request size, binary snapshots, stale files, symlinks, and path traversal.
The Workerd regression verifies plugin registration before recovery, native
tools, cache behavior, restart persistence, and bounded compaction.

Live authenticated inference and the complete deployed journey have not yet
been repeated with this implementation. The evidence below describes older
implementations and does not validate the current container integration.

## Container implementation preview evidence: 2026-09-04

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

## Alternate transport evidence: 2026-09-04

An isolated Alchemy Worker in stage `h2-probe-4595` tested direct transports
without Cursor credentials. The working provider implementation was unchanged.

| Probe                                                               | Deployed result                                                                                          |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Streaming fetch, 5-byte and 65,535-byte bodies                      | Cursor response headers arrived only after closing the request at 7 seconds.                             |
| Streaming fetch, 1,048,575-byte body                                | Headers arrived at 250 ms before closing the request; response-body completion still waited for closure. |
| Streaming fetch, small body left open                               | No response headers before the 10-second abort.                                                          |
| Node TLS with `ALPNProtocols: ["h2"]`                               | Rejected with `ERR_OPTION_NOT_IMPLEMENTED`.                                                              |
| Worker TLS socket to `nghttp2.org:443`, HTTP/2 preface              | HTTP/1.1 400 response.                                                                                   |
| Worker plaintext socket to `nghttp2.org:80`, HTTP/2 preface         | Valid HTTP/2 SETTINGS frame.                                                                             |
| Worker TLS socket to `agentn.us.api5.cursor.sh:443`, HTTP/2 preface | Valid HTTP/2 SETTINGS and WINDOW_UPDATE frames without explicit ALPN.                                    |
| Worker TLS socket to Cursor, HEADERS plus DATA on stream 1          | Cursor returned HEADERS and a Connect unauthenticated DATA frame while the request stream remained open. |

The final socket probe used `cloudflare:sockets.connect` with
`secureTransport: "on"`, sent the HTTP/2 connection preface and SETTINGS, encoded
request headers with literal HPACK fields, and sent an empty Connect message.
It acknowledged the server SETTINGS. It never sent request END_STREAM. The
server DATA frame arrived 32 ms after the request had been written. A Node
HTTP/2 control also received the authentication error before request closure.

This proves direct HTTP/2 transport to the tested Cursor host from a deployed
Worker is possible. The unmodified community provider requires Node, but the socket probe establishes
a path for the Worker-native adapter.

This does not prove authenticated inference, account-specific host routing,
tool-result continuation, or a complete HTTP/2 client. A replacement needs
HPACK decoding, flow control, stream cancellation, connection lifecycle, and
live authenticated verification. Other tested servers rejected the same TLS
approach, so acceptance without explicit ALPN must not be assumed for all
Cursor hosts. Large-body fetch behavior is evidence of buffering effects, not
a reliable workaround for short model requests.

## Native implementation verification: 2026-09-04

The implemented adapter passed eight provider tests, including a real Node
HTTP/2 server fixture. Tests cover a 200 KB duplex exchange through small
flow-control windows, cancellation during a pending write, split compressed
header blocks, trailers, server resets, malformed frame lengths, and per-user
continuation scope across asynchronous stream pulls.

The actual native connector and community provider protocol code were deployed
in the isolated probe Worker. With an invalid test token, they received a
Connect authentication error while the request stream remained open. This
verifies the native connector in Workerd, not authenticated inference. The final
packaged handler also generated PKCE login parameters in the deployed Worker.
The model-only SDK import avoids upstream CLI startup code that Workerd cannot
run.

An intermediate native implementation was deployed to `cursor-4595`, retaining
its existing resources and credentials. The final Alchemy plan updates the
Workers and removes the old Cursor container application. That removal has not
been applied. Authenticated inference and tool-result continuation for the
native implementation remain pending browser authorization. The successful
container checkpoint evidence above does not validate this replacement.
