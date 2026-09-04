# OpenCode recovery and resource verification

The implementation patches OpenCode SDK and core version `0.0.0-dev-18308`. Bun applies both patches from the checked-in lockfile. SDK upgrades must update or remove these patches and pass the runtime smoke test.

## Fixed behavior

- Register initial plugins before starting suspended-session recovery. The regression test failed against the original SDK because recovery observed an empty plugin registry; it passes with the patch.
- Keep the normalized live model catalog when persistent cache writes fail. A forced `SQLITE_TOOBIG` regression test failed against the original core and passes with the patch. A normal refresh reuses the live catalog within its five-minute freshness period.
- Limit pending socket replay events to 256 events or 256 KiB of serialized raw event data. On overflow, close with retry code 1013 and let the client replay from its durable cursor.
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

Production deployment, authenticated browser validation of history paging, and the original Todo build-to-deployment flow remain to be verified. Message paging bounds the number of records per request; it does not establish a byte limit for a single model message or a total heap limit.
