# OpenCode recovery and resource verification

The implementation patches OpenCode SDK and core version `0.0.0-dev-18308`. Bun applies both patches from the checked-in lockfile. SDK upgrades must update or remove these patches and pass the runtime smoke test.

## Fixed behavior

- Register initial plugins before starting suspended-session recovery. The regression test failed against the original SDK because recovery observed an empty plugin registry; it passes with the patch.
- Keep the normalized live model catalog when persistent cache writes fail. A forced `SQLITE_TOOBIG` regression test failed against the original core and passes with the patch. A normal refresh reuses the live catalog within its five-minute freshness period.
- Limit pending socket replay events to 256 events or 256 KiB of serialized raw event data. On overflow, close with retry code 1013 and let the client replay from its durable cursor.
- Limit combined CI stdout and stderr to 12 MiB and cancel streams that exceed that budget. This preserves room for the supported 5 MiB generated lockfile while preventing unlimited log collection.
- Convert reserved incoming WebSocket close codes, including 1006, to a valid outgoing close code and always release subscription state.
- Load conversation history in pages of 20 messages. The initial snapshot reads the latest page. Earlier messages remain accessible through an authenticated paging endpoint and the Earlier messages control. The browser retains one selected history page.

## Repeatable checks

`bun run test:opencode` runs the real embedded SDK regression tests in a separate process from the application unit tests. OpenCode and Sylph use different Drizzle versions; keeping these integration tests separate avoids Bun module-resolution interference.

`bun run smoke:runtime` builds the SDK through the Alchemy Cloudflare Rolldown plugins and starts a real SQLite-backed Durable Object in Miniflare. The test:

1. Initializes 33 plugins and starts a session against a fake streaming model provider.
2. Confirms the model request includes the test tool.
3. Aborts the Durable Object while the model request is in flight.
4. Wakes the object and confirms the same session resumes with the test tool.
5. Waits for successful completion and checks that conversation data survived.

All external provider requests are blocked. No paid model or production resource is used. The smoke command is part of GitHub verification.

The recorded local run completed in 1,161 ms, including a 271 ms host initialization, and stored 249,856 bytes in SQLite. These are local wall-clock measurements with a fake model. They do not measure production CPU time or establish the cause of the earlier production out-of-memory incident.

## Remaining verification and execution work

General command execution is still absent from the embedded workspace. The dependency repair tool remains the existing CI-based implementation. These changes do not claim that arbitrary shell commands now work or that the original Todo deployment smoke test is complete.

The original Todo build-to-deployment flow remains to be verified. Message paging bounds the number of records per request; it does not establish a byte limit for a single model message or a total heap limit.

## Production verification after merge

PR #47 merged as `f1f0a2fecea8a89d5d907b7506e7a8919c7c8e20`. GitHub production run `33921227574` stopped at configuration validation because `BETTER_AUTH_SECRET` was missing from the GitHub production configuration. No upload ran in that workflow.

The saved local production configuration contained the existing required values. The Alchemy plan preserved the database, repositories, and storage; it updated the Website and WorkspaceRuntime and added the merged provisioning resources without deletions. Local `alchemy deploy --stage prod --yes` completed successfully using the clean merged revision.

Cloudflare reported these versions at 100 percent traffic:

- WorkspaceRuntime: `18dd5dfd-c8da-439e-a693-58cf6408c780`, deployed September 4 at 21:32:07 UTC.
- Website: `a72a5c97-8214-4936-b615-a38cbd114f93`, deployed September 4 at 21:31:55 UTC.

Authenticated browser verification used the original Todo workspace `8aba0fca-4f18-4ec7-bf56-994e48a81c3a`. The workspace loaded with the Earlier messages control; clicking it loaded earlier saved messages and exposed Latest messages; clicking Latest messages returned to the current conversation. The tests used the live application, not a mocked page.

A new dependency-repair prompt through GLM 5.2 (free) reached the new runtime but logged `Session.StepFailedError: Provider returned error`. After an explicit runtime restart, a retry through North Mini Code (free) logged `Provider reported an error (finish_reason: error)`. Neither attempt started a new CI instance. The sampled RPC records for the first attempt consumed between 0 and 478 ms of CPU, with some longer wall times. This limited sample does not establish a production latency guarantee or prove all memory failures resolved.

The current implementation still needs general command execution. The Todo dependency repair, Preview lifecycle, Acceptance, and Todo production deployment have not passed. GitHub's production secret configuration also remains unresolved; local deployment did not populate GitHub secrets.

## Continued smoke test

A local production redeploy found all ten resources unchanged. PR #49 adds a failure entry when OpenCode reports a failed turn without an assistant error message. Eight focused tests and all GitHub checks passed. This notice is not deployed yet.

A follow-up model attempt produced no tool call and was interrupted at the configured fifteen-minute deadline. Cloudflare recorded successful alarm events and the browser displayed the interrupted-turn notice. This verifies the deadline for this stalled request, not every multi-step or queued-turn case.

A fresh isolated Workspace under the same Project successfully read `package.json` and reported its package name using a model that previously failed in the original conversation. This comparison shows that the provider and tool path can work in a short session; it does not isolate the cause of the earlier failures. The original Workspace and its files are preserved. A new Todo build is running in the fresh Workspace; no Preview or production Todo deployment has passed yet.

## CI runner output persistence

The installed Cloudflare CI runner returns large stdout and stderr as streams nested inside its result object. A local Workflows reproduction rejected that result as non-serializable. Direct byte-stream results passed. The dependency repair failures observed in production are consistent with a transport problem, but the local reproduction does not establish their complete cause.

The CI patch persists one bounded byte stream for the result envelope, then reconstructs logs and snapshot metadata after the durable step. It preserves existing inline results, cancels source streams on overflow or cancellation, and limits persisted output to 16 MiB. It does not truncate dependency output.

Six focused tests cover a five MiB lockfile, split Unicode, escaping, cancellation, size limits, and older inline output. The real CIWorkflow smoke test preserved 6,990,533 stdout bytes and 440,000 stderr bytes across a local runtime restart, then chained the next runner using the saved snapshot. Exactly two runner invocations occurred, so the completed first command was not repeated. The Sandbox command implementation is replaced by a fixture; Workflows persistence and the CIWorkflow implementation are real.

Clean package installation and the frozen repository installation applied the saved patch. Lint, formatting, type checks, eight runtime unit tests, the OpenCode Durable Object smoke, and the CI Workflow smoke passed locally. The production plan updates Website and WorkspaceRuntime with eight unchanged resources and no deletions. Live dependency repair and the Todo lifecycle remain to be verified after deployment.

The local production deployment of this follow-up succeeded. Cloudflare confirmed both updated Workers at 100 percent traffic, and the authenticated Todo Workspace loaded. All GitHub verification jobs passed for the deployed source revision.

The new live dependency repair still failed after approximately four minutes and twenty-three seconds with `Network connection lost`. Cloudflare recorded a hung `CI.jsrpc` request on the newly deployed runtime. The stream-persistence regression is fixed locally, but this deployed result confirms that it is not the complete explanation for the production failure. A pause was requested for the next automatic retry to stop repeated attempts while the CI-to-Sandbox path is investigated. No successful dependency repair or Todo deployment is claimed.

## Dependency job bounds and CI diagnostics

Dependency installation now has a durable three-job budget, shared across new job IDs and changed commits. A new user prompt or a passing checkpoint Check resets the budget. Replayed creation does not consume another attempt. Checkpoint Checks cannot start while a dependency job is pending, except for the dependency job's own verification handoff. Failed dependency notifications no longer instruct unconditional retries of network failures.

The CI runner emits named stage markers for checkout, process start and exit, preview reads, backup creation, log reads, and cleanup. Markers omit commands, credentials, and file contents. These markers identify the pending operation if the runtime terminates a hung request. Eleven focused Check tests, the full test suite, type checks, lint, frozen installation, and the local CI Workflow replay smoke passed. Production diagnosis remains in progress.

The local patched-package reinstall also removed the nested Sandbox dependency, causing CI to resolve the root SDK version while its container image remained older. The root Sandbox dependency is now pinned to the same version as Cloudflare CI and the image, removing that resolution ambiguity. A release regression test resolves the SDK from CI's module location and checks it against the pinned root dependency and container image. Frozen installation, the version check, and CI replay are revalidated together. This packaging correction does not by itself establish the cause of the earlier live hang.

The diagnostic deployment reached process start and then remained in the process-exit wait. Backup creation and log-result persistence had not started. The runner now polls process state with a deadline instead of depending on the process-log exit event. It preserves nonzero exit codes, rejects missing or incomplete terminal metadata, and requests termination on timeout. Four focused tests cover a process that already exited, running-to-failed transition, a stalled status lookup, and missing completion metadata. The frozen install, thirteen runtime tests, type checks, lint, and CI replay smoke pass locally. The corrected completion path still needs deployed verification.
