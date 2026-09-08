# Cloudflare application recovery

This package supplies a D1 provider adapter and a Workerd writer gate. The default template vendors the implementation and domain schemas so a standalone Project does not require a private workspace package.

## Supported application boundary

One Worker, one application D1 database, and a separate D1 database for recovery coordination. Every application request must pass through `withRecoveryGate`. The read-only verification callback uses a dedicated bearer token and route. The wrapper also waits for application `waitUntil` tasks before releasing its durable writer count. Application code must not start untracked background writes or writes from a response stream. There are no queue, scheduled, RPC, Durable Object, R2, KV, external service, or other writers in this supported boundary. The provider inventory rejects unrecognized bindings and schedules. An application with those features requires an additional tested integration; it must not emit a complete-inventory receipt from this adapter.

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
