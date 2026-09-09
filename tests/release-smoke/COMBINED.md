# Combined lifecycle proof

The ordinary vertical slice verifies setup through acceptance and Workspace runtime recovery. It does not prove production release, deliberate failure, application restore/undo, concurrent Preview isolation or resource cleanup.

Wait for the integrated Sylph commit and a published, immutable compatible template commit. With a clean checkout at that exact source:

```sh
bun run smoke:release:doctor -- --auth magic
SYLPH_SMOKE_GROK_BUDGET=true bun run smoke:release:deploy -- --auth magic --commit FULL_INTEGRATED_COMMIT --template-commit FULL_PUBLISHED_TEMPLATE_COMMIT
```

The deploy writes source, template, branch, stage, configuration snapshot and URL to its private run record. It verifies `/__sylph/smoke-identity` against that record. Open the printed URL. Magic auth proves that isolated sign-in mode; it is not GitHub OAuth evidence. Every fresh setup requires a new stage.

Create the scenario locally from a deployment run record and the checked-in options example. This command reads local files only. It does not load the saved credentials, contact providers, launch a browser or mutate infrastructure:

```sh
bun run smoke:lifecycle create --run /private/run.json --scenario /private/scenario.json --options tests/release-smoke/lifecycle-options.example.json --account-id CLOUDFLARE_ACCOUNT_ID
```

Use a unique Project name and app email in a private copy of the options for each run. The model is fixed to Grok 4.6 because the deployed budget adapter only accepts that model. A random password for the disposable application account is stored privately beside the run; it is never placed in the scenario or printed.

The `smoke:lifecycle` runner accepts a scenario decoded by `@workspace/domain/lifecycle-proof`. Its `identity` must match the deployment; `accountId` must match the saved snapshot; `modelBudgetUsd` is 4 per Workspace, matching the persisted Workspace budget. The initial build and telemetry repair use two Workspaces, so reserve up to $8 for the combined run and account for both ledgers. The create command fills all thirteen paths, source hashes and dependencies. IDs that do not exist before setup are observed during execution and saved in typed state. `prepare` also prints that observed state when available. The runner checks its hash against the preceding action before continuing. Each phase contains:

- `path`, an exact lifecycle path from the schema.
- `target`, the concrete Installation, Project, Workspace, Check attempt, checkpoint, deployment/recovery IDs, URLs and service resource IDs affected.
- `action`, a tracked `tests/release-smoke/actions/<name>.ts` file, and `actionSha256` from its committed bytes.
- `timeoutSeconds` (1–1800), `dependsOn`, and at least one Cloudflare `probe`.
- Each probe has an account-relative `path` and `assertions` of `{ pointer, equals }`. A D1 probe also has one read-only `select`. Other probes can inspect an exact Worker settings/deployment, Workflow instance or D1 database.

For example, a D1 probe against an application's actual database can select its marker after restore and compare `/result/0/results/0/value` with the exact pre-failure value. Combine this with Workflow completion, the persisted Sylph deployment/recovery record and a browser journey. Do not validate recovery solely from a Sylph receipt. Compare the undo point's data separately after undo.

```sh
bun run smoke:lifecycle prepare --run /private/run.json --scenario /private/scenario.json
bun run smoke:lifecycle run --run /private/run.json --scenario /private/scenario.json --phase fresh-setup
bun run smoke:lifecycle report --run /private/run.json --scenario /private/scenario.json
```

`prepare` verifies tracked action files and prints exact approval digests without running them. Production release, deliberate failure, restore, undo and partial-failure cleanup require explicit user approval of the printed target before supplying that phase's `--approval-digest`. A digest is an operator guard, not user authorization by itself. Any other phase containing destructive work also needs explicit approval; phase names do not override this rule.

Each tracked action uses the actual authenticated UI and shares the existing release-smoke flow helpers. Browser execution requires Playwright Chromium installed with `bun run smoke:release:install`. Each action receives the saved snapshot, `SYLPH_SMOKE_BASE_URL`, `SYLPH_LIFECYCLE_SCENARIO`, `SYLPH_LIFECYCLE_PHASE` and a private `SYLPH_LIFECYCLE_OUTPUT` directory. It drives the actual authenticated product using the integrated controls and writes `browser.json` matching `LifecycleBrowserEvidence`. Assertions contain actual observed values, expected values, checkpoint and source identity. Do not construct these values from the expectation. Check exact rendered `SYLPH_CHECKPOINT` and `SYLPH_DEPLOYMENT` values, authenticated journey outcomes and current Check attempt. Keep screenshots/traces beside the browser evidence.

The actions record their actual Cloudflare D1, Worker, Workflow and resource-collection responses in `provider.json`. SQL uses bound parameters and permits reads only. Cleanup absence requires a successful collection read with complete pagination; a 403 or 404 alone cannot prove deletion. The runner validates and hashes that evidence, then makes the configured Cloudflare API probes itself, requires API success, compares the values and hashes the resulting evidence. No local-fixture fallback exists. It saves an attempt before executing and permits one attempt per phase. A crash/failure remains visible and prevents automatic re-execution. Do not delete a record or create a new Workspace to evade its budget. A new reviewed scenario/run must account for earlier spend and retained resources.

`report` checks phase digests and evidence file hashes. Missing phases, mismatched identities, local receipts or absent browser/provider evidence cannot produce a complete result. Logs, saved auth, query results and screenshots may contain private data; keep the run directory local.

## Required observations

| Path                    | Required independent evidence                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| fresh-setup             | New stage, setup/claim journey, exact owner and Installation row                                                                            |
| model-native-commands   | One bounded generation, native file changes, actual Cloudflare shell/job output, command exit status                                        |
| checks                  | Exact checkpoint and current attempt, terminal Workflow and each meaningful Check                                                           |
| authenticated-preview   | Rendered identity plus signed-in navigation, mutation, reload and assertions                                                                |
| acceptance              | Exact accepted commit, browser policy for that attempt, Workspace terminal state and Project Repository HEAD                                |
| production-release      | Reviewed exact commit, completed deployment/Workflow, actual Worker bindings and authenticated production journey                           |
| deliberate-failure      | Bounded approved failure of an exact migration/deployment, actual failure state and previous production behavior                            |
| application-restore     | Approved exact recovery point, app D1 values and R2 bytes/custom/HTTP metadata restored, paired code/secret versions, authenticated journey |
| restore-undo            | Separate approved undo target, pre-restore values restored, authenticated journey                                                           |
| concurrent-previews     | Two live Check attempts/URLs from successive checkpoints of one Workspace, distinct Worker/D1 IDs and cross-Preview read/write isolation    |
| ownership-conflict      | Competing claim rejected before mutation, unchanged owner and actual resource identity/data                                                 |
| partial-failure-cleanup | Approved exact partial resource set, persisted retry state, provider absence with proven access, retained resources still intact            |

The `telemetry-repair` path additionally requires the real HTTP failure, the matching provider request ID in the product incident, a repair Workspace based on that deployed commit, a newly checked and accepted repair, and the original production request succeeding after its release.

## Concrete action sequence

The implementation files are under `tests/release-smoke/actions/`; their shared adapters are `tools/release-smoke/lifecycle-*.ts`.

1. `fresh-setup` proves the Installation was unclaimed, signs in using the recorded auth mode, claims it through setup, and compares the persisted owner with the real session.
2. `model-native-commands` connects OpenRouter, selects Grok 4.6, creates the Project and Workspace, and performs bounded native edits and shell tests. It checks the actual tool Output and file content. The prompt builds an authenticated D1 todo fixture, an authenticated R2 object editor, a disposable secret-version display, a tested production-only failure wrapper and a query-triggered runtime defect.
3. `checks` creates a checkpoint, reads the terminal Check result and all seven stages, observes its Workflow, and discovers the actual Preview Worker and both D1 bindings. Preview Workflows remain waiting during retention; they are not reported as completed while retaining a live Preview.
4. `concurrent-previews` makes one small native edit in the same Workspace, creates another checkpoint, and keeps both Previews alive. Distinct app accounts, Worker IDs, database IDs and writes in both directions prove isolation. Both model Turns share the same persisted $4 Workspace budget.
5. `authenticated-preview` signs in to the app, then uses Sylph's shared Browser Run controls to sign in again in that session. It records a required journey with ordered create/reload and update/reload assertions on desktop and mobile. It uses no policy exception.
6. `acceptance` approves and accepts the current checked checkpoint, waits for the archived Workspace, and compares the accepted commit with the real Project Repository HEAD from the product's repository manifest. Exported access credentials are not retained in the evidence.
7. `production-release` deploys the accepted code with secret marker `before`, creates a signed-in user's D1 todo, then deploys the same code with marker `after`. The second real release captures the recovery point; authenticated mutations establish later D1 and R2 values. Provider GET Object and List Objects responses independently verify exact bytes, custom version metadata, content type and cache policy before and after the release. These are two production mutations in the disposable Project.
8. `deliberate-failure` sets the fixture's `SMOKE_FAIL_RELEASE` application secret, starts a real deployment and requires the expected failing command output. It requires an HTTP 503 maintenance response, the failed release owning a drained recovery gate, unchanged provider deployment/version identity, and unchanged D1 data, then removes the failure setting. The generated guard fails after recovery preparation and before Alchemy publication. Writes can remain paused until the following approved restore.
9. `application-restore` selects the second successful release's saved point. It checks the actual release request fields before dispatch, completed Workflow, restore record, app login, rewound D1 value, paired secret marker, R2 bytes and metadata, and further D1/R2 mutations with reload.
10. `restore-undo` selects the recovery point captured by the restore operation. It independently checks the pre-restore data and secret version, login, mutation and reload.
11. `telemetry-repair` requests the authenticated `/smoke-health?probe=<run marker>` endpoint and requires its deliberate HTTP 500. It independently queries Cloudflare invocation events and requires the same request ID in a product health incident. It creates the linked repair Workspace from the actual deployed commit, has the agent implement and test the repair, then checks, verifies the Preview through Browser Run, accepts and releases it. The original URL must return HTTP 200 with the repaired marker. This second Workspace has a separate $4 budget.
12. `ownership-conflict` creates an empty challenger Project without inference and reviews adoption of the first Project's application resources. It requires an ownership-specific rejection, unchanged original inventory/data, no challenger claims, and unchanged provider bindings.
13. `partial-failure-cleanup` selects `options.cleanupScope`, or the first observed Preview when omitted. It requires a real `cleanup_failed` operation whose original Workflow stopped, with both deleted and remaining application resources. It uses Retry cleanup, proves provider absence and unchanged production data, and verifies that recovery-control state remains retained.

## Explicit preparation boundaries

Start from a fresh Installation with newly deployed resources. Earlier experimental Installations are being discarded; no historical data migration is required.

The product now exposes confirmed immediate cleanup of retained Previews and cleanup retry, but no public control for injecting a partial provider deletion failure. Cleanup empties R2 buckets before deleting them, so a nonempty bucket alone cannot prove failure. Before the final cleanup action, exercise a reviewed provider failure against the oldest disposable Preview, wait for the original Workflow's retries to stop, and inspect its actual failed scope. The action reports `blocked` if that precondition is absent. Do not insert failure rows, synthesize provider receipts, or treat an ordinary complete cleanup as partial-failure proof. The runner retains this blocked attempt; review it before preparing any subsequent run.

Browser controls and all actions are integrated in the single Sylph PR. Read the current template pin from `packages/domain/src/template-release.ts` and verify that exact immutable commit is published before deployment. The obsolete starter 0.2.0 does not satisfy this source contract. Run from a committed, clean combined source and record that exact commit. The follow-up Browser Run fixture passed screenshot-required desktop/mobile journeys and coordinate actions at source a91e848909ec9a093c09482ae990317eeeac9738. See docs/archive/verification/browser-service-followup-smoke.json. This separate service fixture does not substitute for combined product proof.

All thirteen action paths and local preparation are implemented. Local adapter tests are not deployed lifecycle evidence. Deployment, credentials, model inference, production release/failure, restore, undo and cleanup remain subject to the user's live-operation authorization. The ordinary vertical slice remains separately scoped.
