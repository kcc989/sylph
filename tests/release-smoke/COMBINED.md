# Combined lifecycle proof

The ordinary vertical slice verifies setup through acceptance and Workspace runtime recovery. It does not prove production release, deliberate failure, application restore/undo, concurrent Preview isolation or resource cleanup.

Wait for the integrated Sylph commit and a published, immutable compatible template commit. With a clean checkout at that exact source:

```sh
bun run smoke:release:doctor -- --auth magic
SYLPH_SMOKE_GROK_BUDGET=true bun run smoke:release:deploy -- --auth magic --commit FULL_INTEGRATED_COMMIT --template-commit FULL_PUBLISHED_TEMPLATE_COMMIT
```

The deploy writes source, template, branch, stage, configuration snapshot and URL to its private run record. It verifies `/__sylph/smoke-identity` against that record. Open the printed URL. Magic auth proves that isolated sign-in mode; it is not GitHub OAuth evidence. Every fresh setup requires a new stage.

The `smoke:lifecycle` runner accepts a scenario decoded by `@workspace/domain/lifecycle-proof`. Its `identity` must match the deployment; `accountId` must match the saved snapshot; `modelBudgetUsd` is 4, matching the persisted Workspace budget. Define all twelve paths exactly once. Each phase contains:

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

Each action receives the saved snapshot, `SYLPH_SMOKE_BASE_URL`, `SYLPH_LIFECYCLE_SCENARIO`, `SYLPH_LIFECYCLE_PHASE` and a private `SYLPH_LIFECYCLE_OUTPUT` directory. It must drive the actual authenticated product using the integrated APIs/browser and write `browser.json` matching `LifecycleBrowserEvidence`. Assertions contain actual observed values, expected values, checkpoint and source identity. Do not construct these values from the expectation. Check exact rendered `SYLPH_CHECKPOINT` and `SYLPH_DEPLOYMENT` values, authenticated journey outcomes and current Check attempt. Keep screenshots/traces beside the browser evidence.

The runner then makes the Cloudflare API probes itself, requires API success, compares the values and hashes the resulting evidence. No local-fixture fallback exists. It saves an attempt before executing and permits one attempt per phase. A crash/failure remains visible and prevents automatic re-execution. Do not delete a record or create a new Workspace to evade its budget. A new reviewed scenario/run must account for earlier spend and retained resources.

`report` checks phase digests and evidence file hashes. Missing phases, mismatched identities, local receipts or absent browser/provider evidence cannot produce a complete result. Logs, saved auth, query results and screenshots may contain private data; keep the run directory local.

## Required observations

| Path                    | Required independent evidence                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| fresh-setup             | New stage, setup/claim journey, exact owner and Installation row                                                                 |
| model-native-commands   | One bounded generation, native file changes, actual Cloudflare shell/job output, command exit status                             |
| checks                  | Exact checkpoint and current attempt, terminal Workflow and each meaningful Check                                                |
| authenticated-preview   | Rendered identity plus signed-in navigation, mutation, reload and assertions                                                     |
| acceptance              | Exact accepted commit, browser policy for that attempt, Workspace terminal state and Project Repository HEAD                     |
| production-release      | Reviewed exact commit, completed deployment/Workflow, actual Worker bindings and authenticated production journey                |
| deliberate-failure      | Bounded approved failure of an exact migration/deployment, actual failure state and previous production behavior                 |
| application-restore     | Approved exact recovery point, app D1 values restored, paired code/secret versions, authenticated journey                        |
| restore-undo            | Separate approved undo target, pre-restore values restored, authenticated journey                                                |
| concurrent-previews     | Two live Check attempts/URLs at once, distinct Worker/D1 IDs and cross-Preview read/write isolation                              |
| ownership-conflict      | Competing claim rejected before mutation, unchanged owner and actual resource identity/data                                      |
| partial-failure-cleanup | Approved exact partial resource set, persisted retry state, provider absence with proven access, retained resources still intact |

## Integration status

The runner and deterministic validation fixtures are implemented. Concrete action scripts and the final scenario must be completed against the integrated recovery, resource and browser interfaces. They are deliberately not replaced by scripts that manufacture receipts. Until those scripts, the published template pin and the approval targets exist, the combined lifecycle is **not verified**. The run record's ordinary vertical-slice result must remain separately scoped.
