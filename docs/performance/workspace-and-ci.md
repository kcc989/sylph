# Workspace and CI performance

Project creation creates the Project Repository and initial Workspace fork before returning. Creating another Workspace saves its record and waits for Workflow scheduling. `WorkspaceProvisioning` then synchronizes the Project Repository, creates the fork, loads files, installs skills, configures the provider, and starts the session. It reuses a fork that already exists. The payload contains the Workspace ID and, for restarts, the restart request. Credentials are read during execution.

The Workspace screen returns persisted provisioning state immediately. It polls once per second while provisioning and uses the existing WebSocket once a session exists. Failed initialization remains an error until restart. Duplicate create requests reuse the provisioning Workflow ID.

`ProjectSynchronization` serializes synchronization per Project and combines matching concurrent requests. It retains the previous head comparison in Durable Object storage. Both remote refs and upstream authorization are checked on each synchronization; unchanged head pairs avoid another clone and fetch. A cached comparison never replaces the remote ref check. Navigation refreshes upstream state in the background. Explicit synchronization waits for it; new Workspaces synchronize during provisioning.

Git diffs are cached separately for the committed branch and working files. Branch caches use both commit IDs. Working caches use the fork commit and the durable filesystem event revision. Edits, deletions, resets, and new commits invalidate the relevant result. Git object IDs skip unchanged committed subtrees before reading blob contents. Repeated failures are not cached. Each cache retains only its most recent result.

Routine Workspace reads return file summaries without patches. Changes and Review fetch patches when opened. Review patch requests verify the displayed fork commit. Revision keys keep review drafts mounted across unrelated refreshes and transient network errors. Check events load only checks; inbox, form, and tool-start events load only conversation state. Other events refresh the Workspace without reloading dashboard data, deployments, skills, or model options. Full route reloads refresh those settings.

Cloudflare CI reuses installed dependencies and runs verification in one sandbox. Lint and typecheck run concurrently; tests and build run sequentially afterward. Per-stage output and timing markers are retained, including both parallel failures. Set `CI_VERIFICATION_CONCURRENCY=1` through Alchemy configuration for Projects whose verification scripts share mutable outputs. The default is `2`.

GitHub CI persists Bun downloads and Turbo results. Storybook tests run in a separate job with a Playwright browser cache. The final `test` job requires both verification and Storybook to succeed, so both must pass. Production workflow caches use a separate namespace.

## Historical local measurement

The original comparison against commit `3c7a828` used a SQLite-backed Workspace filesystem with 200 files, one branch change, one working-file change, and 20 repeated status reads. Both implementations returned identical snapshots across their repeated reads.

| Measurement                                    |   Before |    After |
| ---------------------------------------------- | -------: | -------: |
| First status read                              | 32.30 ms |  8.33 ms |
| Median repeated status read                    | 22.87 ms | 0.022 ms |
| File-content reads across 20 repeated requests |   16,260 |        0 |

These measurements describe the local fixture, not deployed latency. Each cached read queries the indexed filesystem event sequence in SQLite. Regression tests verify zero file-content reads after warm-up and correct invalidation after edits, deletions, checkpoints, and filesystem clearing.

## Deployment validation

`alchemy.run.ts` declares the `WorkspaceProvisioning` Workflow and `ProjectSynchronization` Durable Object bindings in the app Worker. Verify those bindings and the deployed source when measuring a stage; their declarations do not confirm a deployment.

Measure creation response time separately from time until the Workspace is ready. Exercise concurrent creation from an imported Project, unchanged and changed upstream refs, initialization failure, restart, and Durable Object eviction. Measure Cloudflare CI with cold and warm dependency caches and compare serial with concurrent verification on the same commit and runner size. Report sandbox setup, command time, snapshot time, preview deployment, and browser evidence separately. Measure deployed performance before claiming an improvement.
