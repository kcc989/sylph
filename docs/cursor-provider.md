# Cursor subscription through OpenCode

Sylph registers `cursor-opencode-provider@0.6.6` through its public provider API.
The unmodified provider runs in a Node 24 Cloudflare Container. OpenCode runs in
the Workspace Durable Object and manages history, tools, permissions, and durable session events. Sylph saves Checkpoints. This community provider is not the official Cursor Agent SDK.

Alchemy declares the private `CURSOR_RUNTIME` binding in `alchemy.run.ts`.
Container identities include the user Durable Object, connection generation,
and OpenCode session. Authentication operations use a separate container.
Each stream receives a current Workspace file snapshot at `/workspace` for the
provider's native file checks. Unsafe paths are rejected, stale files are
removed, and overlapping requests are rejected before replacing the snapshot.
OpenCode executes file tools in the durable Working copy and shell tools through the workspace Sandbox. Requested Checks and Deployments use Cloudflare CI.

The bridge maps OpenCode's `shell` tool name to Cursor's `bash` name when needed, preserving schemas, call IDs, permissions, and results. It exposes Max Mode as an explicit model variant when supported by the provider catalog.

## Credentials and isolation

The per-user Cursor Durable Object encrypts OAuth tokens and pending login state
with AES-GCM using `CREDENTIAL_ENCRYPTION_KEY`. The personal provider connection
stores an encrypted handle. Each request must match the current connection.
Tokens are sent only through the private container binding. The browser receives a PKCE URL and status. Tokens are not included in the image or its environment.

Disconnect deletes the stored connection and prevents further authenticated
requests. Reconnecting uses a new container identity. An already running stream
must be cancelled separately. Idle containers sleep after ten minutes; their
local files and continuation state are temporary. OpenCode history remains
in Durable Object storage. No dependency patches or custom HTTP/2 implementation
are used.

## Verification

1. Follow the [release smoke runbook](../tests/release-smoke/README.md) to deploy an isolated Alchemy stage. Use the existing GitHub App and OAuth proxy when testing GitHub login; magic-link mode does not prove OAuth.
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

## Source and evidence

The implementation is in [the provider package](../packages/cursor-provider), [Cursor connection storage](../apps/web/src/server/cursor-connection-object.ts), and [the container class](../apps/web/src/server/cursor-runtime-container.ts). Use the [direct provider probe](../tools/cursor-smoke/README.md) to separate upstream transport failures from Sylph integration failures. A direct probe does not validate the product journey.

[Dated provider results](archive/smoke-tests/cursor-provider-2026-09-08.md) include retired transports. The [registration and shell bridge record](archive/smoke-tests/cursor-registration-2026-09-08.md) records later experiments. Check each result’s source and scope before reusing it. Before continuing a run, verify the deployed source and fixture state.
