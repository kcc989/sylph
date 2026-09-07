# Sandbox agent and D1 todo smoke, 6 September 2026

The deployed verification passed. Acceptance and archival are not verified.

## Identity

- Platform stage: `smoke-mtqjj5in-7d0333`, using magic-link authentication.
- Platform source: `c84bc8e4b25660c8a0523b414256e1590dadae06` plus this working tree's sandbox, permissions, synchronization, budget, and conversation-summary changes.
- Workspace: `65114d46-3600-4f6d-b501-215e2c875b8a`.
- Todo checkpoint: `97976ab9e54fe135f22f45d6fd3e2f82c147cda8`.
- Preview: <https://sylph-release-smoke-vertical-slv5bq4ubjqev5lbye3dzlpdr.apingot.workers.dev>.
- Proof marker: `sylph-release-smoke-1788743512849`.
- D1 database: `b202999d-d578-4b75-a9a1-e970df946be0`.

## Verified

OpenCode used native file tools and shell commands through the Cloudflare Sandbox workspace provider. The shell ran Node, Bun, Git, package installation, typecheck, tests, and an executable script that printed `SYLPH_SANDBOX_OK`. File changes returned to the durable Workspace and its Checkpoint. The agent created the todo implementation, migration, server functions, UI, and tests.

The repaired checkpoint passed all seven recorded Checks: install, typecheck, lint, tests, build, preview deployment, and browser evidence. The final Playwright verification passed in 12.7 seconds while resuming the existing built Workspace without another model request.

The test created a todo, queried the Preview Worker's actual D1 binding, reloaded, completed the todo from a second independent browser context, confirmed `completed = 1` through D1 and the first browser, deleted it, and confirmed the row and checkbox were absent. Runtime restart preserved the proof file. Rendered deployment identity matched the actual checkpoint and preview kind.

The deployed conversation shows separate expandable summaries for consecutive inspections, file changes, and commands. Expanded details preserve ordered calls and their input/output. Failed calls remain visible. The regression covered collapsed/expanded details and mobile inspector switching. Local tests, lint, typecheck, formatting, and the deterministic Workerd native-shell fixture passed.

## Cost and limitations

All paid model calls used OpenRouter `x-ai/grok-4.6`, including title and compaction calls. Key usage rose from $124.477876542 to $125.590780542: **$1.112904**, below the user's $5 run limit. The disposable profile reserves a conservative $4 maximum per Workspace before requests and persists that ledger across runtime restarts. Summary grouping makes no model calls.

Earlier agent turns repeated inspections and were interrupted; the successful app required follow-up instructions. The initial Preview failed because the upstream template omitted Alchemy's optional Effect platform peers. The agent repaired the generated project's manifest and generated a matching lockfile with Bun. The upstream template was not changed.

Native file edits and shell calls auto-approve inside the workspace sandbox. This does not implement a separate model-based command reviewer. The stale active-turn guard was removed, execution-start events now trigger refresh, and active runtime polling reconciles missed terminal events.

The harness was corrected to wait for current Checks, asynchronous checkbox updates, and the acceptance response before navigation. A prior acceptance attempt was cancelled by navigation. Automatic approval review then rejected the full retry because accepting a checkpoint and archiving the Workspace were outside the explicit todo-verification request. The passing run used `SYLPH_SMOKE_VERIFY_ONLY=true`; it skipped review approval, acceptance, and archival. No full acceptance lifecycle or production deployment is claimed.

## Local evidence

- `.alchemy/smoke-runs/smoke-mtqjj5in-7d0333/run.json` records the passing verification-only scope.
- `.alchemy/smoke-runs/smoke-mtqjj5in-7d0333/budget.json` records model usage.
- `playwright-report/release-smoke/smoke-mtqjj5in-7d0333/index.html` contains D1 rows, the todo screenshot, and the explicit `acceptanceVerified: false` attachment.
- `docs/sandbox-agent.md` describes the execution boundary and limitations.
