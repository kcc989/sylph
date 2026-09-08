# Managed application state

Managed adapters require application code to use their wrappers for every read, write and consumer callback. A resource declaration alone does not make raw bindings recoverable. Review the complete application entrypoints before enabling a declaration. Keep journals in a captured application D1 database, separate from the recovery-control database.

## KV

Apply `src/managed-kv.sql` to the application database. Provide `ManagedKvLive` with that database, the exact KV binding and a stable logical namespace. Use the `ManagedKv` service for reads, writes, deletion and listing. The journal stores bytes, JSON metadata, absolute expiration and an immutable version. Values are bounded to 1 MiB, metadata to 1024 UTF-8 bytes and keys to 512 UTF-8 bytes. Listing returns up to 1000 keys; pass the last key as `after` for the next page.

D1 is authoritative. Each read observes a primary D1 revision before consulting the version-addressed KV cache. A cache miss, outage or digest mismatch falls back to the journal. Restoring or undoing the application D1 database changes the visible logical KV state without waiting for globally cached KV entries to expire. Absolute expiration still uses the current time after restore. Physical cached versions expire separately and are not a byte-for-byte namespace backup.

All application access must remain inside the shared recovery writer gate, including asynchronous work. Direct KV writes and reads bypass this contract. This wrapper adds a D1 read to each logical KV read; it is intended for recoverable state, not a replacement for every native KV use case.

## Queues

Apply `src/queue.sql` to the captured application database. Provide `CloudflareRecoveryQueueLive` with the database, exact Queue transport and stable queue name. Enqueue with a stable message ID and JSON body. The journal commits before the Queue notification is sent, so a failed send can be replayed without losing the message body.

Queue notifications contain only journal identity. Consumers decode the notification and call `consume` with an idempotent handler. Missing and already completed messages are ignored. A failed handler does not complete its journal row. All producers and consumers must share the recovery gate; `withRecoveryQueueGate` retries batches while the application is paused.

After restore or undo, replay pending journal rows before resuming the writer gate. The replay is bounded and paginated. Duplicate and stale transport notifications remain safe only when handlers honor the stable message ID. External side effects require their own idempotency protocol and cannot be undone by restoring D1. The adapter does not snapshot Cloudflare's transport backlog.

Local Workerd tests cover journal rewind, KV restore/undo, cache failure and corruption, metadata and expiration, message replay and duplicate handling. These tests do not establish deployed Cloudflare recovery proof.
