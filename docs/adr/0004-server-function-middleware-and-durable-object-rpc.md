# Guard server functions with middleware and use Durable Object RPC

Product actions use TanStack Start server functions. Each function declares its access checks through `apps/web/src/functions/middleware.ts`. Middleware supplies the session, database, and authorized resource to the handler.

Failures use `Schema.TaggedError` from `@workspace/domain`. The adapter in `apps/web/src/start.ts` serializes them so the UI can check failure tags instead of matching messages. Workspace Durable Object RPC methods accept encoded domain schemas.

The browser event stream uses a Hibernatable WebSocket on `fetch`, as described in [ADR 0007](0007-hibernatable-workspace-websocket.md). Authentication, setup callbacks, and the scoped deployment broker have dedicated HTTP endpoints. Add another HTTP router or framework only when a public API requires it.
