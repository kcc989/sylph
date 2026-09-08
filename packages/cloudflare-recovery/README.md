# Cloudflare application recovery

This package supplies coordinated D1, R2, managed Queue, and registered Durable Object recovery with Workerd writer gates. Managed KV uses an authoritative application D1 journal; see [managed state](./MANAGED-STATE.md). The default template vendors the implementation and domain schemas so a standalone Project does not require a private workspace package.

## Supported application boundary

A recovery group covers up to four owned Workers, twenty application D1 databases, twenty R2 buckets, and one shared recovery-control D1 database. Managed KV and Queue bindings require exact resource and journal database declarations. Every producer, consumer, HTTP handler, and registered Durable Object operation must use the shared gate and await all writes. Ordinary HTTP `waitUntil` work and Queue callback `waitUntil` work drain before their writer count is released. Untracked background writes, stream writes, scheduled handlers, external writers, and unreviewed raw storage access are outside this boundary.

Registered SQLite Durable Objects additionally support up to 100 fixed object identities per group through the cooperative snapshot protocol below. Live inventory rejects missing declarations, additional stored objects, unowned service targets, unreviewed Queue actors, and unknown bindings. A declaration is not evidence that arbitrary application code uses the recovery wrappers: source review, an authenticated application journey, and a restore drill are required before claiming complete application recovery.

Apply `src/control.sql` to the recovery-control D1 database through Alchemy. Do not apply it to the application D1. The control database contains writer ownership, immutable encrypted manifests, deployed secret snapshots, and restore-operation evidence. It must not be rewound with application data. It remains an owned resource in the Project resource plan and needs Installation-level backup. It is not an application-data restore target.

The adapter uses Cloudflare D1 Time Travel. It records a bookmark while writes are paused, hashes the schema and all application rows, and requires the bookmark to remain unchanged during capture. The current adapter supports at most 10,000 rows per table; larger tables fail closed. It verifies row counts to reject truncated provider results. Recovery points expire after six days, within the documented minimum seven-day Time Travel window. Captures require a successful provider restore drill for the same schema within 30 days. A capture cannot invent a restore timestamp.

A restore loads the immutable saved manifest and checks its hash, identity, expiration, encryption, and fresh same-release undo point. It records the operation before calling Cloudflare. After the provider returns, it independently reads and hashes the restored schema and every bounded row. Only an exact match records successful restore evidence. A failed or uncertain restore retains the pause and prevents automatic retry or resume.

## Hook integration

Use `CloudflareD1RecoveryLive({ accountId, apiToken, controlDatabaseId, projectId, encryptionKey })` to supply `CloudflareD1Recovery` through an Effect Layer. The encryption key is a base64-encoded 32-byte AES key. The `fetch` and `now` overrides are for tests.

1. Review migration compatibility before mutation. The template owns the Git and application compatibility checks.
2. Authenticate the current Worker's read-only probe using `SYLPH_BASE_URL`. Verify its full checkpoint and deployed release ID. Pause with `pause(releaseId)` and drain all active requests. The adapter waits up to 30 seconds for admitted requests to finish. If they do not drain, the gate remains paused for operator reconciliation.
3. Run `inventory` against live Worker settings and schedules. Supply the exact database ID and all deployed secret binding names. For the initial bootstrap there is no live Worker; the template first creates only its reserved D1 databases.
4. Call `capture({ databaseId, releaseId, liveReleaseId })`. It reads the immutable encrypted secret snapshot of the actual live release, not edited Project settings. Compare those values to keyed fingerprints from the authenticated live Worker before emitting the recovery receipt. Bootstrap stages the first candidate's secret map before capture because no prior deployed secrets exist.
5. For an explicitly authorized recovery, load the selected `readManifest(id)`, then call `restore(manifest, releaseId)`. The normal prepare step must already have saved a fresh undo point under the new release ID.
6. Resolve deployment secrets in memory. For a restore, call `secrets(selectedManifest)`; otherwise use the configured target secrets. Call `stageSecrets(releaseId, values)` before publishing the Worker and bind that release ID to the deployed Worker. The stage call is idempotent only for identical values and refuses to overwrite a secret version. Never write decrypted values to a file, receipt, or Workflow return.
7. Verify the application's authenticated read-only journey while paused, resume, and then run its full create/read/delete journey. The application implements these journeys. A homepage or provider receipt is insufficient.

`SYLPH_RECOVERY_KEY` is derived separately for each Project from the Installation encryption key and is supplied only to prepare, restore, and deploy. `SYLPH_RECOVERY_SECRETS` contains the target Project secrets and is supplied only to prepare and deploy. `SYLPH_RECOVERY_VERIFY_TOKEN` is a separate Project-scoped key supplied to release hooks; it permits only the template's read-only probe. The recovery encryption key must never be deployed as a Worker binding. Preserve the Installation encryption key for old snapshots; rotating it without a vault re-encryption procedure makes those snapshots unreadable.

## Failure reconciliation

`gate()` reports the owner and active count. `adoptPause(expectedPreviousOwner, newReleaseId)` requires zero active writers and compares the exact previous owner. It is for a new Admin-authorized recovery after inspecting the failed release. An ordinary release must not adopt a pause. Request crashes can leave a nonzero count; the adapter does not expire it or silently reset it. An operator must first prove the old Worker and every in-flight task are stopped before repairing that count. Keep the old operation and undo manifests.

An operation in `restoring` or `uncertain` must not be retried. Inspect Cloudflare state and the saved manifest. Run a new explicitly authorized recovery with a new release ID and fresh undo point. A failure after publication can leave new code live while writes remain paused. A successful data fingerprint does not establish that the application journey passed.

## Isolated provider drill

The local tests use SQLite-backed provider responses and actual local Workerd. They are not deployed proof. `src/provider-drill.ts` calls the real Cloudflare API and destructively restores only a separately provisioned `sylph-recovery-drill-*` database. No real-provider run has been performed for this change.

Before running it, obtain approval for the disposable resource deployment, credential use, and restore. Bootstrap the target disposable template stage first so its control D1 exists and `control.sql` is applied. Provision a distinct drill database through `tools/recovery-smoke/alchemy.run.ts`:

```sh
bunx alchemy deploy tools/recovery-smoke/alchemy.run.ts --stage recovery-drill-UNIQUE
```

Use a lowercase unique suffix. Set `SYLPH_RECOVERY_DRILL_MIGRATIONS` to the same application migrations used by the release, including the first starter release: bootstrap applies those migrations before capture. Leave it unset only when the actual application database has an empty schema. The drill schema must match the application schema being captured. The harness writes proof into the target stage's control D1. It pauses that gate, so use only the approved disposable stage, never a live application's control database.

Set these values through the approved environment loader without printing credentials:

- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`
- `SYLPH_PROJECT_ID`, `SYLPH_RECOVERY_KEY`
- `SYLPH_RECOVERY_CONTROL_DATABASE_ID`: the disposable template's control D1
- `SYLPH_RECOVERY_DRILL_DATABASE_ID`: the separate Alchemy-created drill D1
- `SYLPH_RECOVERY_DRILL_CONFIRM`: exactly `restore:<drill database ID>`

Run `bun packages/cloudflare-recovery/src/provider-drill.ts`. The harness checks the provider-reported database name, captures actual state, creates and populates a probe table, observes the changed fingerprint, restores the original bookmark, and independently reads the result again. Successful output contains only IDs, hashes, and timestamps. Retain this evidence with the exact integrated commit and stage identities. There is no automatic cleanup; Alchemy destruction requires separate approval.

The harness fails closed if a prior run left the control database paused. Inspect and reconcile that run before proceeding. The reusable adapter does not register a fake proof for a schema that has not passed the provider drill.

## Provider references

- [D1 Time Travel retention and restore semantics](https://developers.cloudflare.com/d1/reference/time-travel/)
- [Get a D1 bookmark](https://developers.cloudflare.com/api/resources/d1/subresources/database/subresources/time_travel/methods/get_bookmark/)
- [Restore a D1 bookmark](https://developers.cloudflare.com/api/resources/d1/subresources/database/subresources/time_travel/methods/restore/)

## Managed Queue recovery

`./queue` supplies `CloudflareRecoveryQueue` and `CloudflareRecoveryQueueLive({ database, transport, queue })`. Apply `src/queue.sql` to an application D1 database included in the recovery group. The journal stores immutable message IDs and JSON bodies, creation times, and completion state. Cloudflare Queue holds only `{ version: 1, queue, id }` notifications. These notifications can be lost, duplicated, expired, or left over from a later release without changing the saved logical messages.

Call `enqueue({ id, body })` from a recovery-gated producer. Choose a stable application idempotency key before the call and retry with that same ID and body after any error. The journal write happens before publication, so a failed send leaves a replayable pending message. Reusing an ID with a different body fails. Completed IDs remain as tombstones. Each journal table holds at most 10,000 messages including tombstones, matching the bounded D1 snapshot adapter; a body is limited to 64 KiB. Capacity requires an explicit retention and recovery design, not silent deletion of tombstones.

Wrap every consumer with `withRecoveryQueueGate` from `./worker`. Inside it, decode each notification with `RecoveryQueueNotification` from `@workspace/domain/cloudflare-queue-recovery`, then call `consume(notification, handle)`. A successful call permits transport acknowledgment. A thrown error must cause retry. The handler receives the saved message body and must await all effects before returning. The callback gate drains `waitUntil` work and retries incoming batches during recovery maintenance. Consumer handlers must be idempotent using the stable queue and message ID: delivery is at least once, and concurrent duplicates can run before completion is recorded. External side effects are not undone by restoring D1.

Run `replayPending({ limit: 100 })`, then continue with the returned `nextCursor` as `afterId` until it is null. Run this scan after every restore and periodically to repair notifications lost through publication failure, retention expiry, or dead lettering. Scan from the beginning on each new pass. The replay operation only publishes notifications; consumers remain gated during a trusted restore hook. A restored pending message runs again, while stale notifications whose journal rows disappeared are ignored. Normal replay and producer calls must also participate in the shared gate. Queue ordering and delayed delivery are outside this initial protocol.

The tests run the journal on local Workerd D1 and exercise actual Workerd queue callbacks. The journal rewind test simulates restored D1 rows; it does not claim a Cloudflare provider restore drill. Raw Queue producers, legacy queued payloads, and arbitrary consumer Workers are not recovered by this adapter. The release inventory must explicitly verify adoption before admitting a managed Queue binding.

Cloudflare documents [at-least-once delivery and idempotency keys](https://developers.cloudflare.com/queues/reference/delivery-guarantees/). Its [pull consumer API](https://developers.cloudflare.com/queues/configuration/pull-consumers/) leases and acknowledges messages; it is not a point-in-time snapshot API. Arbitrary KV snapshots remain insufficient because [KV changes can take 60 seconds or more to propagate](https://developers.cloudflare.com/kv/concepts/how-kv-works/). [Durable Object PITR](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api) is available inside each SQLite object and requires cooperative restore and restart handling.


## Registered Durable Object recovery

`./object` supplies `CloudflareObjectRecovery` and `CloudflareObjectRecoveryLive({ ...configuration, identities, transport })`. Apply `src/object-control.sql` to the recovery-control D1 database. Add `durableObjects: [{ bindingName, namespaceId, objectIds }]` to each bound Worker's topology and provide the object Layer to `CloudflareRecoveryGroupLive`. The group captures objects with D1 and R2, authenticates every saved object and fresh undo point before any restore mutation, and independently verifies all restored resources before recording success.

The application class exposes a private recovery method that calls `recoverDurableObject(state, controlDatabase, identity, request, afterRestore)` from `./object-worker`. A dedicated authenticated Worker route must validate the reviewed binding and fixed object registry before forwarding `RecoveryObjectDispatch`. Derive registered object IDs from reviewed names with `namespace.idFromName(name).toString()`; verify namespace IDs against live Worker settings. Each ordinary object operation must use `withRecoveryObjectGate`, reject unregistered object IDs before writing, and await all writes. No constructors, alarms, WebSocket events, or detached tasks may write outside the gate. The required `afterRestore` callback clears or reloads class memory caches; a failure retains the application pause. An uncached class can supply an empty async callback.

Snapshots contain actual SQLite ordinary tables and indexes, row identities, binary SQL cells, and JSON-compatible Durable Object KV values. The helper restores SQL and synchronous KV in one SQLite transaction. It then reads the object again and requires an exact snapshot match. A separate transport call independently reads and compares the object after the restore response. A lost response records an uncertain operation and prohibits automatic retry; it never records successful restore evidence from an acknowledgment alone.

The bounded protocol allows 32 tables, 1,000 rows per table, 1,000 KV values, and 4 MiB per object. It refuses foreign keys, generated columns, virtual tables, triggers, views, AUTOINCREMENT tables, shadowed rowid column names, alarms, active WebSockets, non-JSON KV values, non-finite SQL numbers, and SQL integer values outside JavaScript's exact range. Implicit rowids are preserved as decimal text. These refusals protect data fidelity; they are not full SQLite support.

Object snapshots are encrypted in 32 KiB chunks using the Project recovery key and identity-bound authenticated encryption. Manifests and restore operations remain in the recovery-control database, outside application rewind. The registry is fixed: adding or removing object IDs or namespaces makes old group topology incompatible and requires an explicit migration plan. Recovery does not silently delete objects born after a snapshot. Provider namespace enumeration rejects unregistered instances.

For a fresh installation, first verify the Worker is absent, create recovery control, and pause the gate. Publish only the maintenance-gated Worker and registered object classes. Resolve the registry through the authenticated route, inspect live bindings, then capture actual empty objects with ordinary group capture. Do not invent empty object manifests while their Worker is absent, and do not open the gate during bootstrap. A partial bootstrap must remain paused.

Local tests use real Workerd SQLite objects to verify table/index/blob/KV restoration, nonsequential rowids, pause checks, unsupported-state refusal, and uncertain-operation handling. Group coordination tests use provider fixtures. These tests do not establish a deployed provider drill or an application journey. The implementation uses [SQLite transaction and storage APIs](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), while [namespace object enumeration](https://developers.cloudflare.com/api/resources/durable_objects/subresources/namespaces/subresources/objects/methods/list/) checks the fixed registry.
