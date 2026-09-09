# Production releases and application data

An Organization Admin must confirm the Accepted commit before production deployment. Only one production operation can run per Project. A database reservation rejects concurrent or stale requests before CI starts. The baseline commit and URL identify the latest published deployment, even if that operation later failed. A failure before publication does not change the baseline.

A basic release installs, builds, validates the resource plan, and deploys the Accepted commit. Managed recovery and application verification run together when `managedRelease` is selected. Browser evidence is a separate option, `captureEvidence`. Both default to off for product requests. Data recovery always enables managed release.

A managed release reviews migrations, saves a recovery point, verifies the application with writes paused, resumes writes, and verifies again. Selected browser evidence also requires a rendered commit marker. Failure after publication retains the production URL; the failed release may still be serving users.

## Managed storage requirements

Only D1 resources may use purpose `recovery_control`; R2 drill buckets must use a supported application plan. Recovery-control storage is excluded from application cleanup and restore.

Before first-release migrations, managed recovery verifies that the initial Workers are absent. Before capture, application migrations must be applied and isolated provider restore tests must pass for that schema. Capture then records the D1/R2 recovery group. The application must control every writer and disable bucket policies that change objects. Test Time Travel and R2 metadata handling against the provider. Failed or uncertain restores keep writes paused.

## Application integration

A basic release needs `build`, `sylph:plan`, and `sylph:deploy`, plus a supported dependency manifest. Managed release requires all six scripts below, including restore support before the first capture. Missing hooks block managed release only. Cloudflare CI runs them without automatic retries.

The application must implement and test these hooks: backups, restore, resource inventory, migration checks, writer control, and user journeys. Sylph checks their receipts and execution order; it cannot verify restore correctness from receipts alone.

Worker+D1 applications can use [packages/cloudflare-recovery](../packages/cloudflare-recovery/README.md). That guide defines supported storage, secret versions, provider drills, and recovery after failure. Other applications need their own tested integration. A hook must perform its operation before printing a receipt.

| Script                  | Required behavior                                                                                                                                                                                                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sylph:release:review`  | Compare migrations, infrastructure, and deploy scripts between baseline and target. Test code compatibility with the current schema, or the restored schema for recovery. Include earlier-code redeployments. Exit nonzero if unsafe or unknown; do not change production.                          |
| `sylph:release:prepare` | Pause all writers, including scheduled jobs and queue consumers, and finish in-flight writes. Inventory stateful resources and secret versions. Save coordinated recovery points, including an undo point for restores. Confirm each backup is available and its restore procedure has been tested. |
| `sylph:release:restore` | With writes paused, restore every resource in `SYLPH_RECOVERY_POINT`. Recheck each backup’s availability and expiry. Restore secret versions through the configured store. Verify all resources before printing the receipt.                                                                        |
| `sylph:deploy`          | Deploy the selected commit while maintaining the write pause. Print `SYLPH_PRODUCTION_URL=https://...`.                                                                                                                                                                                             |
| `sylph:release:verify`  | Test `SYLPH_PRODUCTION_URL`: assert the full commit and production identity, sign in as a dedicated test actor, change and verify application data, and delete test records. Use a restricted verification path while writes are paused. Repeat after writes resume.                                |
| `sylph:release:resume`  | Resume all writers after the first journey passes. Repeated calls must be safe. Exit nonzero on failure.                                                                                                                                                                                            |

All release hooks receive `SYLPH_RELEASE_ID`, `SYLPH_PROJECT_ID`, `SYLPH_PROJECT`, `SYLPH_CHECKPOINT`, `SYLPH_DEPLOYMENT=production`, `SYLPH_BASE_COMMIT` (empty for the first release), and `SYLPH_RECOVERY_POINT` (empty for an ordinary release). Verification and resume also receive `SYLPH_PRODUCTION_URL`. Provider operations receive Cloudflare credentials; journeys receive no explicit Cloudflare credential binding. `BETTER_AUTH_SECRET` is supplied to deployment. Hooks must obtain other application secrets from the configured secret store, never from receipt fields.

Receipt schemas are defined in `packages/domain/src/deployments.ts`. Print each required marker with one JSON receipt on a single stdout line. Timestamps are Unix milliseconds. Use full Git commit IDs and the IDs supplied in the environment.

- `SYLPH_MIGRATION_REVIEW`: `{ deploymentId, commit, baseCommit, compatible: true, evidence }`. Evidence identifies the compatibility checks and results, without secrets.
- `SYLPH_RECOVERY_POINT`: `{ deploymentId, projectId, commit, baseCommit, capturedAt, expiresAt, writesPaused: true, inventoryComplete: true, resources }`. Each resource has `{ id, kind, backupRef, restoreVerifiedAt }`. Kinds are `database`, `object-storage`, `kv`, `durable-object`, `secret`, or `other`.
- `SYLPH_DATA_RESTORED`: `{ deploymentId, recoveryDeploymentId, commit, restored: true, resources }`. Resources must list every `kind:id` from the selected recovery point exactly once, with no extras. Missing or partial restore evidence blocks code publication.
- `SYLPH_PRODUCTION_JOURNEY`: `{ deploymentId, commit, url, passed: true, journeys }`. The nonempty journey list describes what was exercised. A URL or a homepage health check alone is not an application journey.

### Recovery point validation

- Save an unexpired capture from the last 15 minutes before publishing. Use the earliest resource expiry.
- Cover every existing owned stateful application resource, including retired resources with retained data. Sylph refreshes provider IDs before checking coverage. Use an empty list only for a confirmed stateless application. New reservations without provider IDs contain no application state.
- Exclude recovery-control resources from application restore.
- Use opaque backup and secret-version references, never secret values, credentials, or signed download URLs. The application checks secret snapshots separately because secret bindings are not resource-registry entries.

When browser evidence is selected, the application must render a visible element with `data-sylph-checkpoint` equal to the full commit and `data-sylph-deployment="production"`. Cloudflare Browser Run waits for this marker and stores screenshot and accessibility evidence. For a managed release, this happens after writers resume and before the final live verification. A paused application may block the public homepage; its private verification path must remain available to the dedicated verification actor.

## Recovering code and data

Select **Recover code and data** on a saved recovery point. Confirm its code commit and capture time, and acknowledge possible loss of later writes. The server rechecks Admin access, the Accepted commit, Project ownership, expiry, and the selected point. Recovery creates a new deployment with its own undo point and evidence. Failed releases do not start restores automatically.

**Redeploy** applies earlier code to current data; it does not restore data. Migration compatibility and backup requirements apply when managed release is selected. A basic redeployment does not create a recovery point. If a release fails after capture starts, ordinary redeployment is blocked because data or writer state may be uncertain. An Admin must select a valid recovery point. If none was saved, follow the application’s provider recovery procedure to inspect and repair its data and writer state. Do not clear the failure to bypass this requirement.

If restore, publication, or verification fails before resume, the application must retain its write pause. A resume failure may be partial; the second journey can also fail after writes have resumed. Inspect the saved failure and application writer state before selecting another recovery point. Expired points cannot be selected for restore. CI command retries are disabled because repeating a restore can discard additional writes; individual hooks must handle partial provider failures explicitly.

## Repository export scope

The version 2 repository manifest provides temporary Git access and repository heads. It excludes application data, secrets, and Workspace runtime state: messages, running agents, pending operations, and Durable Object storage. Application recovery points appear in Deployment history. Backing up Sylph itself requires a separate operator procedure.

## Rollout and verification

The initial schema in `packages/db/migrations/0001_initial.sql` includes release receipts and an index that permits one queued/running deployment per Project. This baseline requires fresh resources; it does not upgrade earlier experimental databases.

Local tests simulate CI, Browser Run, and provider receipts with SQLite. They also run the release pipeline with its writer controls to check HTTP responses while writes are paused and resumed. They cover ordering, incompatible migrations, missing/expired/unsaved backups, incomplete restores, mismatched journey commits, writer resume failures, and verification failures after publication. They do not prove a real provider backup or live restoration. Before production rollout, test the application's hooks in an isolated stage with real data, concurrent writers, a deliberate migration failure, complete restore, and a verified production journey. Production deployment and destructive restores require separate explicit approval.
