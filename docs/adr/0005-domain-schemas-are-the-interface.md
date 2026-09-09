# Export domain schemas and keep codecs at I/O boundaries

`@workspace/domain` exports schemas, IDs, tagged failures, and pure functions, organized by the terms in CONTEXT.md. Each module that reads or writes external data defines its own codec with `Schema.decodeUnknownPromise` or `Schema.encodeSync`. The domain package does not export an extra codec for every schema.

`apps/web/src/server/workspace-runtime-client.ts` exposes decoded domain types and adapts the Durable Object RPC stub. Tests use a fake stub.

Workers RPC preserves only an error's message. `serializeServerFailure` therefore encodes tagged failures in a `@sylph/failure:` message, and `runtimeFailure` restores them in the Worker. Middleware and Durable Object errors reach callers with the same tags.
