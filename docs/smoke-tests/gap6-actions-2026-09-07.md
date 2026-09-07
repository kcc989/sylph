# Gap 6 concrete actions

The proof branch now contains all twelve tracked lifecycle actions and `smoke:lifecycle create`. The command prepares a complete local scenario from a run record and typed options without contacting a provider or loading credentials. Execution uses the authenticated product UI, existing flow helpers, and recorded Cloudflare reads. IDs come from actual setup, D1 rows, Checks, Worker bindings and Workflows. The runner validates action evidence and preserves a hashed state snapshot between phases.

The native generation and small concurrent-Preview edit share one Workspace's persisted $4 Grok budget. Browser acceptance uses the pending shared Browser Run controls, required desktop/mobile CRUD journeys and the current Check attempt. Production, restore and undo each verify actual application-user login, D1 mutation/reload and rendered checkpoint identity. Recovery additionally checks a disposable application secret-version marker. Release request validation decodes the product's current TanStack wire format and checks the Project, confirmed commit and selected recovery ID before dispatch.

The failed-release fixture wraps the existing production deployment command with a tested exit-73 guard controlled by the Project's `SMOKE_FAIL_RELEASE` secret. Normal deployments keep the original command and five release hooks. The action verifies real failing output and previous production state, removes the failure setting and leaves recovery to the next explicitly authorized phase. It does not fabricate a migration failure or report paused writes as healthy writes.

Ownership conflict uses the product's adoption review. Partial cleanup uses its retry control and requires real provider-visible partial deletion plus a persisted `cleanup_failed` operation. Provider absence is checked through successfully authorized, fully paginated resource collections; inaccessible resources are not treated as deleted. Recovery-control state and production data must remain intact.

Local verification:

- `bun test --timeout 30000 tools/release-smoke packages/domain`: 112 passed across 18 files. A first concurrent run hit the existing preservation test's default five-second timeout; the bounded rerun passed.
- `bun test tools/release-smoke/lifecycle-actions.test.ts`: 8 passed after the final request-target check; includes real CLI execution, bound SQL request shape, failed provider responses, collection pagination and access denial, replaced identities, exact release wire fields and error redaction.
- `bun run lint` and `bun run format:check`: passed.
- `bun run typecheck`: all six workspace packages and root TypeScript passed. Turbo reported cache-write permission warnings, which did not affect the checks.

No deployed lifecycle phase ran. No saved credentials were loaded, no provider requests were made, and no publication, stage deployment, model inference, production release, restore, undo or cleanup occurred.

Remaining live dependencies:

1. Root must integrate the final browser branch and this commit into the single Sylph PR and record that exact clean source.
2. Publish and pin the final compatible starter after root's cross-review. Candidate `53be0a3cf72778fe82a81b8fd4bd0111ba0ae375` is superseded work in progress, not an approved deployment pin.
3. Obtain the user's authorization for publication and the complete disposable deployment, credential, inference and mutation scope. Then deploy a new magic-auth stage, install Playwright Chromium if needed and run the concrete phases in scenario dependency order.
4. The partial-cleanup test needs an actual controlled provider deletion failure on the first observed Preview, with the original Workflow's retries stopped. There is no public product fault-injection control. The action reports this boundary as blocked instead of inserting ownership/failure rows or generating receipts.
5. Earlier-Installation migration remains a separate unsupported boundary: encrypted D1 round-trip and retained old Worker/DO identity are verified locally, but schema conversion and complete Durable Object export are not implemented. Keep the old Installation until those concrete migrations are verified.

See `tests/release-smoke/COMBINED.md` for commands, exact action behavior and evidence files. Local fixtures and these tests are not deployed proof.
