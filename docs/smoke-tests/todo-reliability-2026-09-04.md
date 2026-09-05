# Todo reliability smoke test, 4 September 2026

Status: in progress. This run is independent of the earlier todo smoke reports.

## Target

- Installation: https://sylph-website-prod-tquagcyfrjtqy2zg.apingot.workers.dev
- Project: Todo Reliability Sep 04
- Workspace: f6ef7e31-a67c-4753-9c21-85f42f4855ff
- Local source: ce6ad8b2c10fb5389ad009613cde8451408f4cd3. The live Installation has not been verified to run this revision.
- Method: authenticated Sylph browser UI, with an isolated copy of kcc989/sylph-tanstack-template. No upstream GitHub synchronization.

## Observations

1. Default template creation failed with `ArtifactsError: repo already exists: sylph-template-cloudflare-tanstack-main`. Copy-only GitHub import recovered creation. The Workspace was observed ready within 44.1 seconds of import submission; polling makes this an upper bound.
2. Aion-2.0 used built-in read and shell tools against `/workspace`; reads and shell commands failed. Its subsequent `workspace_list_files` calls filtered by `/workspace` and `.`, leading it to infer an empty repository despite the UI listing 39 starter files.
3. The agent attempted to replace the starter with Hono/Wrangler and a fake lint command. The first write was rejected; subsequent pending writes were cancelled. No proposed write was approved. Recovery switched to Claude Sonnet 4.6 with explicit direct reads and preservation of the starter.
4. Cancellation remained displayed as active until reload. Reload showed `Step interrupted` and preserved conversation history.
5. The latest three production platform deployment runs failed. Run 33929034895 for the local source revision failed configuration validation at missing `BETTER_AUTH_SECRET`; its environment also showed other required deployment values empty. No platform production deployment was attempted in this smoke test.
6. Sonnet recovered the original starter and wrote `src/todo.ts`, `src/todo.test.ts`, and `src/routes/index.tsx`. The first Check, `check-2fdf7473-8f15-41cf-b7d3-0ceefb33a17f`, failed at checkpoint `2a566ab` because `FilterKind` needed a type-only import. Install took 21.0 seconds. Lint passed in runner logs but remained queued in the failed Check panel.
7. The agent passed `repairOnFailure` as the string `"true"` twice; validation correctly rejected it. It then submitted without the flag and incorrectly told the conversation that the tool did not accept parameters. The earlier automatic-repair omission is therefore not proof that the API lacks this capability.
8. After the import repair, cached install took 2.3 seconds. Typecheck, lint, tests, and build passed in a shared runner taking 93.8 seconds including setup and snapshot. Command durations were 15.7, 0.7, 1.0, and 3.3 seconds. Preview remained pending at this observation.
9. Check `check-dd3ca76d-2a3d-4bb8-a5c7-0127ba03c4fd` at checkpoint `c9dc2ba` failed Preview because Alchemy could not import `@effect/platform-node/NodeServices`. The Workflow ran from 23:31:17 to 23:35:12 UTC. Preview occupied 137.6 seconds: three identical failures separated by 30- and 60-second delays. The first failure took 15.4 seconds; retries added about 122 seconds without changing inputs.
10. The agent was directed to add exact `@effect/platform-node` and `@effect/platform-bun` devDependencies at `4.0.0-rc.111`, and the matching `@effect/platform-node-shared` override, preserving Alchemy and Effect versions. The manifest edit and `workspace_install_dependencies` lockfile operation were approved through Sylph.

## Local verification

The current checkout already contains duplicate-repository error normalization and its regression test. The repository-store and project-template suites passed: 11 tests, 21 assertions. This local evidence does not establish that the fix is deployed.

The current checkout also normalizes file-list root aliases, including `.`, `/`, and `/workspace`. The filesystem suite passed: 13 tests, 72 assertions. The live failure therefore reproduces behavior already addressed locally.

## Pending acceptance

Build the todo app through Sylph, pass all Checks and Preview browser identity, exercise todo lifecycle and reload persistence, accept and deploy this isolated Project, then repeat production lifecycle and record timings.

## Native OpenCode tool requirement

The user clarified that Sylph should use native OpenCode tools wherever possible and behave like a traditional coding agent.

Current inspection shows `WorkspaceDO` starts OpenCode Workerd with plugins and creates sessions at `/workspace`, without binding an OpenCode workspace provider. The plugin instead registers custom durable file tools and instructs the model to use them. The live native read and shell failures above demonstrate the resulting mismatch.

The installed SDK exposes `Environment.Driver` with file-operation overrides and a process spawner, and `WorkspaceDriver` with create, connect, idle, and destroy operations. Native reads consume the environment file interface. This is the integration point to evaluate, preserving native tool arguments, output, and permissions. Shell execution must use Cloudflare CI and share the same working-copy contents with native file tools; changing tool names alone does not satisfy this requirement.

The local implementation now binds OpenCode's native Environment files interface to WorkspaceFilesystem through the SDK's existing embedded Layer override mechanism. The Workerd SDK wrapper patch exposes that mechanism; native tool implementations are unchanged. Read, write, edit, and GPT patch operations passed a Workerd runtime probe with explicit completed-tool assertions. File changes survived Durable Object restart. The final probe took 1.47 seconds with a deterministic local model fixture, not a real provider.

OpenCode exposes patch for GPT models and edit/write for other models. Sylph preserves that selection. Duplicate custom read/write/edit tools were removed. A recursive file listing and file deletion fallback remain. Native glob and grep now use the DO durable working copy through the native search service interface. Git ignore rules, path scopes, hidden files, cancellation, UTF-8 byte offsets, and bounded non-backtracking regex search have focused tests. Native shell and PTY still require a separate process host. OpenCode remains in the DO.

Native mutations enforce Workspace writability and protect Git metadata. Build-agent native edit permissions ask before mutation. Local adapter, permission, and verification suites passed 17 tests and 59 assertions; web typecheck, lint, and build passed.

The dependency repair Workflow timed out at 23:49:18.793 UTC, exactly 720 seconds after its install step started, without command diagnostics. No successful lockfile repair is claimed. Preview and production runner retries are now disabled locally to avoid repeating unchanged deployment errors.

An isolated `native-todo-0904` Alchemy plan showed 10 resources to create and none to update or delete. The stage deployed at https://sylph-website-native-todo-0904-2qqzdn7j3uv4i2hz.apingot.workers.dev. Saved smoke configuration lacked trusted origins and its GitHub callback failed; an exact-origin setting and supported test sign-in enabled isolated testing. Native Todo Sep 04 was created from the standard template within 19.5 seconds (observed upper bound), Workspace b2f40ec5-26ac-402a-ba9e-2265d104e4ff. Live Sonnet native reads completed successfully. The production Sylph Installation has not been changed.

## DO-first follow-up

The user requested that commands run through the DO wherever possible. Native glob and grep passed the Workerd probe, and both completed live in Workspace b2f40ec5-26ac-402a-ba9e-2265d104e4ff. They found src/lib/todos.ts, src/lib/todos.test.ts, and the hydrated-state persistence guard in src/routes/index.tsx without a CI job. The complete local native-tool/recovery fixture took 2.16 seconds, with 222 ms boot time.

The isolated dependency Workflow dependencies-417b611a-473e-4643-af34-c553e2691cc2-attempt-1 failed with WorkflowInternalError after 144.6 seconds in its install step. No precise infrastructure cause is established. An unchanged retry was rejected. A subsequent frozen Check failed because no repaired lockfile had been saved.

A local reproduction with the same Bun 1.3.12 generated the corrected 200,851-byte lockfile in 989 ms. A full frozen install then produced about 1.2 GB of node_modules on macOS. These are local measurements, not Cloudflare measurements.

Dependency repair now generates and validates the lockfile with --lockfile-only, leaving actual package installation to normal Checks. Its five real-Bun regression tests passed with 31 assertions, including absence of node_modules and lifecycle script side effects. This removes installed packages from the repair snapshot.

The corrected path was deployed to the isolated stage. Its one authorized attempt, dependencies-fd06d691-f528-442a-a0db-c39a177ac6ce-attempt-1, failed with `Network connection lost.` The install step ran from 2026-09-05T00:34:51.591Z to 00:39:14.186Z, or 262.595 seconds. The checkpoint was 828403b11830ea5cd5134c43f1f1809ec6787bb9. Workflow completion was successful because its pipeline caught and recorded the failure; the dependency operation itself failed. Removing the full install did not resolve the infrastructure failure. Its precise failing sandbox operation remains unknown.

Installation and verification now share a runner, removing an intermediate workspace backup and restore. Deployment remains a separate credentialed runner. Web typecheck and lint passed; dependency and verification tests passed 12 tests with 54 assertions. The isolated Alchemy deployment completed successfully. This pipeline simplification has not passed an end-to-end live Check yet.

The live agent also reported OpenRouter insufficient credits. No credit purchase or provider replacement was attempted. The todo app has not passed Preview, production deployment, or browser lifecycle acceptance. Native shell execution remains unavailable; native file and search operations run directly in the DO. Test magic links were disabled again after isolated setup.

## Runner diagnosis

Cloudflare telemetry for the failed lockfile-only attempt identifies a successful source checkout in 1,758 ms, followed by a canceled CiSandbox.startProcess RPC lasting 260,299 ms. The CI invocation reported that the Workers runtime canceled a hung request. This narrows the failure to process startup, before the snapshot step.

The CI dependency patch now uses bounded sandbox.exec, preserves heredoc boundaries with newlines around the command, and retains direct stderr if the shell fails before creating log files. A first exec probe returned in 3.4 seconds with exit 2, exposing the missing heredoc boundary. A real shell regression test now checks heredocs, quoted output paths, and failure status. Cloudflare also reported SDK 0.12.9 against container 0.12.1; the root SDK dependency is now pinned to the image's 0.12.1 version.

The corrected adapter was deployed to the isolated stage. Dependency probes were started through the Cloudflare API with the existing Sylph checkpoint and Workspace, without requiring a successful model turn. The initial API request followed a string params schema but was rejected before any step ran; the corrected request uses an object payload. Probe dependencies-native-exec-heredoc-0904-attempt-1 returned a concrete failure in 4.6 seconds: dependency repair required git ls-files, but CI exports source without .git. Repair now reads source files directly, pruning dependency/cache/Git directories. Regression fixtures now omit Git metadata, matching the real CI layout.

Dependency Workflow dependencies-native-source-0904-attempt-1 passed. Its runner took 4,650 ms; the complete pipeline from first publish to final publish took 6,791 ms. The generated lockfile was saved in the DO, a checkpoint was created, and dependencies-native-source-0904-verification-attempt-1 started automatically. The authenticated browser confirmed the successful repair and running normal Check. Model delivery still encounters insufficient credits.

Normal verification at commit 79f94c68d399a68c216076a806a258bbf90a9a24 completed in 24.3 seconds with an actionable typecheck failure: the app used Schema.NonEmptyTrimmedString, which Effect v4 does not export. Package installation took 5.57 seconds and lint passed. A GLM free-model attempt was rate-limited; the connected Free Models Router then completed native read/edit/read and checkpoint creation. Its exact one-line repair uses Schema.NonEmptyString.check(Schema.isTrimmed()). The repaired commit is f9f6a7024c069471db81f88b6628830ecaf8f5a3.

The repair exposed another platform bug: workspace_run_checks tried to create a new checkpoint even when the working copy was clean. It now reuses the checkpoint matching forkHead. Failed shared runners now preserve proven successful stages and mark unfinished stages skipped. The real-shell stage-reporting regression passed, as did web typecheck and lint. Both fixes were deployed to the isolated stage. The native Workerd/recovery probe passed again in 2.17 seconds with 207 ms boot time; its existing deliberate-recovery global-scope warnings remain.

The agent then successfully ran workspace_run_checks on its clean checkpoint, proving checkpoint reuse live. Check e4059508-c949-40ed-8bfb-04de72732327 returned in 28.1 seconds with a readonly-array type error. The agent repaired parseTodos with a shallow copy using native edit, creating commit d97ca9bfa05df6034225e37a40b88569abe438eb. Check e6d627e4-fc36-42d9-9cef-f79af7b3c49e returned in 17.1 seconds: install, typecheck, and lint passed; 43 tests passed and one failed. The failing test proves parseTodos drops valid rows when one stored row is malformed. A repair turn is active with instructions to preserve valid rows and keep the test unchanged.

The full local typecheck and test commands passed after the platform changes, including 264 web tests. No live app Preview or production deployment has passed yet. The UI also intermittently exposes Send while a Turn is active; its server rejects the submission and a refresh reveals Queue/Steer. These rejected submissions did not mutate app files. Cloudflare still emits a CI invocation cancellation diagnostic after recorded command failures, although those Workflows persist and deliver the specific command failure successfully.

## Chat corrections and passing preview

Check check-d1d08b70-4c3c-47b0-8b3c-bbcab1064ca7 passed for commit 525f3be33ca3f813d41f561efc969a77ba36c5ff. Its rendered stage report records install 6.6 seconds, typecheck 11.3 seconds, lint 0.2 seconds, test 0.5 seconds, build 2.4 seconds, preview 147.3 seconds, and browser passed. The preview is https://sylph-native-todo-sep-04-websinrl4uzpkaeamqubbsr5235fz.apingot.workers.dev. Independent browser interaction verified add, edit, complete, active and completed filtering, persistence after reload and hydration, reopen, delete, and blank-input rejection. Rendered identity reports the full commit above and deployment kind preview. Production acceptance remains pending.

Generated check messages now use native OpenCode prompt metadata. The runtime projects compact summaries into chat and queued-message payloads, keeping diagnostics in Checks and model context. Known historical check notifications also project to summaries. Explicit user-origin messages retain their full text. The deployed stage visibly rendered `Checks failed · d97ca9b` and `Checks passed · 525f3be` with View checks controls instead of the full CI reports.

The missing session.execution.started event is now forwarded to the browser. Send resolves to queue when the server observes an active turn, and prompt failures refresh runtime state while preserving the draft. A live Luna submission exposed a null delivery value rejected by the native prompt API. Idle delivery is now omitted. The Workerd native-tool and recovery fixture passed with prompt metadata in 1.59 seconds and 236 ms boot time. Live resubmission remains pending deployment of that correction.

The user requires GPT-5.6 Luna for all remaining Sylph workspace smoke turns. The exact configured model is openrouter/openai/gpt-5.6-luna. No further free-model fallback is authorized.

The corrected Luna submission persisted successfully and the selected model survived reload. OpenRouter then rejected inference for insufficient credits. The user explicitly switched the remaining test to Nemotron 3.5 Lightning (free), model nvidia/nemotron-3.5-lightning:free. That model completed native read and edit, removed the remaining parser comment, created a checkpoint, and started Check check-70c92d52-3e80-4833-9d52-73fac62cd00a. The workflow was confirmed running through Cloudflare. Its model reply incorrectly cited the older passing check; that reply is not evidence for the new checkpoint.

Live observation also found a second composer status defect: workspaceRuntimeStatus treated a completed assistant tool message as an idle execution even when OpenCode reported the session active. It now uses the authoritative active-session flag alone. Focused status regression tests, lint, and full typecheck passed. Deployment and live active-control verification for this final status change remain pending the running Check.

Nemotron's Check check-70c92d52-3e80-4833-9d52-73fac62cd00a passed all seven stages for da87f30357bfbbc232eb2a40cda40c7ec729e8a4. The rendered stage durations were install 4.3 seconds, typecheck 9.6 seconds, lint 0.7 seconds, test 0.9 seconds, build 3.0 seconds, and preview 139.1 seconds. Shared verification including runner setup and snapshot took 28.3 seconds. The new preview at https://sylph-native-todo-sep-04-websioragopzngyiamsdwkkaezkko.apingot.workers.dev rendered the exact full checkpoint and preview identity; add and persistence after reload passed independently.

The platform full test command passed, including 266 web tests. The unsupported-reasoning error on a follow-up came from rejecting the native `default` variant because it is not in the explicit reasoning variants list. Default is now accepted and compared equivalently with an omitted variant. Active-turn status and this fix are being deployed to the isolated stage. No model-provider credits were purchased.

Further live testing showed the custom reasoning preflight also rejected Nemotron's displayed Thinking setting. That preflight has been removed: native OpenCode's model resolver already validates variants and reports VariantUnavailableError. Sylph still prevents model or reasoning changes during an active execution. The final active-turn and queued-message browser tests are not yet proven.

After removing the duplicate reasoning preflight, Nemotron with Thinking completed two read-only native-tool turns. The composer showed Agent working, Cancel Turn, Queue and Steer, and disabled model/reasoning selection while the session was active, including after completed read calls. A follow-up submitted through Queue persisted and received `Queue smoke passed.` The checkpoint review was approved in the Sylph UI; acceptance is in progress. The free-model setting remains selected.

Acceptance initially failed with `Workspace fork default ref is missing`. Source inspection found WorkspaceGit using direct repository-handle defaultBranch properties, while RepositoryStore already resolves Artifacts RPC metadata through info(). WorkspaceGit now resolves that metadata for hydration, project-head refresh, rebase and sync. The focused Git/filesystem suite passed 19 tests, and full typecheck and focused lint passed. This is a metadata correction, not evidence that the Project repository lacks a branch. Isolated deployment and acceptance retry are pending.

## Efficiency and cache audit

The metadata correction was deployed to the isolated stage. Acceptance has not been retried. Mobile preview exposed an unbroken checkpoint footer that widens the page. A free-model repair was started, then canceled when the user raised model cost and execution efficiency concerns. The smoke goal is paused. The reported $100 spend and repeated 200k-token requests have not been independently reconciled against provider billing.

Local changes remove the Check polling tool and deliver ordinary Check results through native synthetic context without resuming inference. Explicitly requested automatic repair can still resume. Native context compaction and an outbound request size backstop were also added. These changes remain undeployed and need complete runtime lifecycle verification before live use.

The installed native OpenCode runtime already supplies a stable prompt cache key and X-Session-Id header. Its default cache policy explicitly skips OpenRouter, so automatic Claude caching is now enabled through native catalog model body configuration using cache_control with ephemeral type. Explicit settings are preserved. Other models, including the selected free Nemotron model, retain their existing cache behavior. The implementation follows https://openrouter.ai/docs/guides/best-practices/prompt-caching.

The local Workerd fixture sent two agent turns through the native OpenRouter adapter to a mock provider. It verified the cache field, stable session key, unchanged tools and earlier message prefix, and retention of provider-reported cache read and write tokens. Title generation is counted separately from agent turns. All external requests were disabled. The fixture passed in 1.85 seconds with 232 ms boot time; existing global-scope recovery warnings remain. Five focused cache and request-limit tests passed, full typecheck passed, and full lint passed. Cache changes are not deployed. These results verify request configuration and usage accounting, not real provider cache hits or billed savings. No paid inference was performed during this audit.

## Resumed smoke verification

Native synthetic Check delivery was verified in Workerd: resume:false leaves the session inactive and makes no provider call; the next user turn includes the Check result. The fixture also verifies that the outbound size guard blocks an oversized request before the mock provider receives it. The combined fixture passed in 2.077 seconds with 226 ms boot time. Full platform tests passed after updating the old Check-delivery prompt assertion; full lint passed.

The efficiency and cache changes were deployed successfully to native-todo-0904. The prior Check workflow was verified in its retain-preview sleep, with all execution steps successful. On reload, the newly deployed instance model policy made the saved free model unavailable and selected Sonnet as fallback. No prompt was sent in that state. Through Administration, the isolated instance was restricted to Nemotron 3.5 Lightning (free) alone, and reload verified the workspace's free model and Thinking on.

The resumed native mobile repair prompt failed without a visible assistant error. Exact isolated runtime telemetry reported Session.StepFailedError: Failed to read openrouter/openrouter stream. The native size-guard fixture produces a terminal failure before provider transport, but the live failure's underlying cause has not yet been established. The same prompt was not retried. The working copy still contains only the saved main min-w-0 change. Mobile completion, latest Check, acceptance, production deployment, and live provider cache savings remain unverified.

The missing error was traced to the runtime message projection dropping native compaction messages. Failed compactions now project a compact assistant error; successful compaction internals remain hidden. Ten focused message/notice tests, full typecheck, and lint passed. The fix was deployed to the isolated stage. Reload now displays `Could not shorten conversation context: Failed to read openrouter/openrouter stream`, confirming the failure occurred during native compaction. No new inference was requested. Native source shows compaction uses agentID compaction and bypasses ordinary context hooks, while the outbound request guard applies to it. The underlying stream failure still needs a specific cause before another inference attempt.

The request guard now distinguishes ordinary inference (128 KiB) from native compaction (1 MiB). The Workerd fixture verifies an oversized ordinary request is blocked before transport and native compaction recovers that saved conversation with exactly one mock request. Combined recovery/cache/native-tools verification passed in 2.342 seconds with 244 ms boot; focused limits tests, lint and full typecheck passed. The correction was deployed. A single free-Nemotron recovery attempt proceeded, then terminated with a visible native compaction error: `Upstream idle timeout exceeded`. It was not repeated.

The saved working-copy edit was instead checkpointed through Sylph's direct UI, without inference. Checkpoint 1f5dbe2 started Check check-badabc16-4e64-47f1-ac2e-0ed4391d2b88 attempt 1 automatically. Install, typecheck, lint, test and build passed in one shared runner (41.5 seconds including setup and snapshot; stages 7.2, 13.4, 0.2, 1.4, 5.2 seconds). Preview is running and browser verification is queued. Acceptance and production remain pending. The interrupted and failed conversations remain intact.

Attempt 1 terminated during preview with `Connection closed: this Durable Object instance is no longer active. Reconnect or retry the request.` The compact Checks failed notice appeared without triggering inference, proving nonresuming Check delivery live. One explicit retry was started through the UI after verifying the Workflow terminal state. Attempt 2 passed install through build in 27.5 seconds including setup/snapshot and is running preview (Workflow check-badabc16-4e64-47f1-ac2e-0ed4391d2b88-attempt-2). No additional model prompt was sent.

The failed Check also exposed a UI mapping bug that labeled skipped stages as passed. The local mapping now preserves skipped, and the presentational UI uses a neutral icon. Focused regression tests, full typecheck and lint passed. This reporting change is not deployed while the Check is active. No browser result should be inferred from the earlier incorrect passed label.

## Accepted baseline and fresh-session mobile fix

Attempt 2 of check-badabc16 passed preview and browser verification. The reviewed checkpoint was accepted at full commit 1f5dbe2b726b5182ac9105e73ecb27fbd6bb01ff. The merge Workflow completed merge-workspace-fork, record-accepted-commit and delivery, then entered retention sleep. D1 confirmed workspace status archived, merge_status merged and the exact accepted commit. The page remained stale until reload because its transitional polling handled provisioning but not merging. A local fix now refreshes both transitions; full typecheck and lint passed. The earlier suspected database overwrite race was not observed and no race fix was applied.

A fresh workspace, coral-panda (7d56af31-9ce5-4d19-a554-09fa595302a8), was created from the accepted Project. Nemotron 3.5 Lightning (free), Thinking on, used native read/edit. One ambiguous edit was rejected without file mutation; the model corrected it with surrounding context. The resulting CSS-only patch adds input width constraints and footer break-all. It started exactly one Check and ended the turn without polling.

Check check-4ec497a8-5dd2-4f85-a700-8c171b86b038 attempt 1 passed all stages for commit 2964958429f8e90caa07ad0fc2bfb1ad1af515c9. Install through build took 39.6 seconds including setup/snapshot. Preview: https://sylph-native-todo-sep-04-websi5om5wugbhjsyjsnfi7mrkzai.apingot.workers.dev. Independent browser interaction verified add, edit, complete, completed filtering, reload persistence, reopen, delete, and blank-input rejection. The 390px embedded preview visibly fits Add and all filter tabs and wraps the full checkpoint string. The exact full commit and preview identity were rendered. The status-display fixes are deploying before acceptance and production verification.

## Final acceptance and production approval

Acceptance initially failed with `Workspace fork changed after review`. D1 confirmed the workspace branch is coral-panda. Acceptance fetched the Project default branch from the fork instead of the workspace branch. The fix passes workspaceRef separately, retaining the Project default branch as the merge destination and preserving the reviewed-head guard. Eight focused merge/readiness tests and full typecheck passed. The isolated native-todo-0904 platform deploy completed successfully.

The existing approved checkpoint was accepted again through Sylph without a new model call or rebuild. D1 confirmed archived, merged, accepted_commit 2964958429f8e90caa07ad0fc2bfb1ad1af515c9, and no error. The inspector changed to archived/read-only without a page reload. The deployment list needed a reload to show the newly accepted commit; it then selected 2964958 as the latest Accepted commit and showed no production Deployments yet.

Automatic approval review rejected the browser Confirm deploy action because it requires explicit authorization for the Project production deployment. No production deployment was started. The confirmation remains prepared for checkpoint 2964958. Production execution and independent production verification remain pending user approval; the goal is not complete.

## Authorized production deployment

The user explicitly authorized deploying checkpoint 2964958 to the todo Project production environment. The first production job, c1810cef-9120-4762-83d3-d48974b6e385-0d2b0ca6-d8f7-426b-85d3-65c66cc356f0, passed install/build in 26 seconds, then failed because the generated template requires BETTER_AUTH_SECRET. It did not publish an app.

Sylph now creates a random 256-bit authentication secret per Project, stores it using the existing AES-GCM credential encryption, and supplies it only to the production runner. Concurrent creation uses an insert-on-conflict followed by an authoritative read. It does not return plaintext from a Workflow step. Native Cloudflare CI includes injected environment values in its log redaction. Migration 0021 adds project_auth_secret. Eight focused tests, full typecheck, lint, and diff checks passed. Tests cover concurrent creation, retries, Project isolation, ciphertext storage, and incorrect decryption keys. The isolated stage migration and deployment succeeded.

The corrected deployment, c1810cef-9120-4762-83d3-d48974b6e385-807de1ab-7339-47d8-a9a8-a6386b0816b7, passed install/build in 23.5 seconds. Cloudflare published the production Worker at 03:28:33 UTC, then ended the production Workflow step with WorkflowInternalError after approximately five minutes. The deployment record therefore incorrectly reports failure. No application error or completion logs were returned. The cause of the internal error is not established.

Production URL: https://sylph-native-todo-sep-04-websiqf7s6tuyboad7j7jwvnuwynd.apingot.workers.dev. Independent browser interaction verified the exact full checkpoint 2964958429f8e90caa07ad0fc2bfb1ad1af515c9 and production identity, add, edit, complete, active/completed filtering, reload persistence after hydration, reopen, delete, and blank-input rejection. One independent HTTP measurement returned 200 with 162 ms first-byte and total time; this is a single observation, not a load benchmark.

The workspace deployment panel now refreshes only deployment data every three seconds while a deployment is queued or running, without reloading the conversation. Full typecheck and lint passed and the isolated stage deployed. One controlled redeployment of the same authorized commit is running to verify successful completion reporting after the internal Cloudflare error. No model inference was requested for these production operations.

The controlled redeployment c1810cef-9120-4762-83d3-d48974b6e385-dce4fd82-5fdb-402d-b3c8-4403083fdde0 completed successfully in 154 seconds. The authoritative Workflow completed record-deployment-succeeded and publish-run-passed. D1 records succeeded, the exact full commit, and the production URL above. The workspace panel updated to succeeded and Open production without a reload, verifying the refresh fix. The final deployed page again rendered the full checkpoint and production identity. A new task persisted through reload and was deleted afterward. Three additional HTTP samples all returned 200 with 105–112 ms total response time.

The end-to-end todo smoke test is complete: native agent editing using free Nemotron, durable files, passing checkpoint checks, approval and acceptance, production deployment, and independent application interaction. The earlier report sections retain evidence for queue/steer/cancel, compact nonresuming Check notices, native recovery fixtures, and cache configuration. This does not establish production-scale reliability, eliminate external provider/Workflows failures, or prove paid-provider cache savings. One free-model legacy-context compaction timed out and one production Workflow encountered a Cloudflare internal error; neither was retried in an automatic model loop. Platform changes remain in the working tree and isolated stage; the main Sylph production platform was not deployed.
