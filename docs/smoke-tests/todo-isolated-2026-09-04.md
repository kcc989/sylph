# Isolated todo smoke test, 4 September 2026

Status: completed. This is a separate run from `todo-2026-09-04.md` and does not change that earlier run's results.

## Deployed evidence

- Sylph stage: `todo-smoke-20260904`, using the proxy configuration from the operator's smoke-test environment file.
- Project: `Cloudflare Todo Smoke`.
- Workspace: `94390a6e-5d1f-4fe4-8774-7e4a02aff8ad`.
- Model: Aion-2.0 through the configured OpenRouter connection.
- Accepted app commit: `9595c50976cc89ba3f57c2298691c2305785269b`.
- Check: `check-44198aea-0fd0-40b6-9a57-b246f842ee0d`, attempt 1; all seven stages passed.
- Production Workflow: `a09816fd-48a7-450f-a407-d193addced12-6e816412-0586-4b6e-ba6e-8265ed164479-attempt-1`; passed.
- Production: <https://sylph-cloudflare-todo-smoke-wewtvswr62r4hd75unwzfyxdfx.apingot.workers.dev>.

Acceptance and production deployment were exercised through authenticated Sylph UI after explicit user approval. The live app rendered the full accepted commit and `SYLPH_DEPLOYMENT=production`. Browser tests passed for adding two todos, editing, completing, Active/Completed filters, reload persistence, deleting, and clearing completed items. The two test todos were removed. Persistence is browser-local storage, not shared server storage.

## CI measurements

The final checkpoint's install cache hit took 2.4 seconds. Typecheck, lint, test, and build ran sequentially in one unprivileged sandbox. The shared runner took 129.5 seconds including setup and snapshot; command times were 21.4, 0.5, 2.2, and 4.5 seconds respectively. Preview deployment remained a separate credentialed runner and took 109.3 seconds.

An archive-only dependency-cache experiment was removed. Its verification runner suffered a network error, and its preview failed restoring a sandbox backup. It did not establish an end-to-end improvement. The retained implementation caches installed dependencies and combines only the four verification commands. Type checking and sandbox snapshot overhead remain substantial.

## Scope and limits

The Sylph changes cover provider input serialization, template ref selection, shared verification, timing output, and browser readiness. The generated app also needed dependency repairs, a same-element DOM identity marker, and an Alchemy-managed persistent authentication secret. Those app edits live in the accepted Sylph Project repository, not in this platform PR or the upstream template repository. The disposable app currently lacks a committed dependency lockfile; this is not a reproducible-template proof.

The deployed Sylph checkout started at `dd8ed67` with these fixes applied. The PR was then rebased onto `935d8dc`, preserving main's disabled inner verification retries. Local checks apply to the rebased branch; the deployed lifecycle evidence does not claim that the exact rebased PR head was deployed. Earlier recovery and shell changes already on main are not reintroduced here.

The browser readiness attributes are now an explicit Project contract. Existing Projects and upstream templates need those attributes before their next browser check. Failure-stage display and stale live UI state still warrant follow-up; passing this lifecycle is not a claim that all runtime reliability issues are solved.
