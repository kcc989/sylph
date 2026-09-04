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
