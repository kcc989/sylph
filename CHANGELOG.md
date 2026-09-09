# Changelog

## Unreleased lifecycle verification

- Added managed KV and Queue journals, registered SQLite Durable Object snapshots, and first-release object restore drills.
- Added a full telemetry-to-repair journey and independent R2 restore/undo metadata checks.
- Added source-linked removal preparation, exact Queue consumer detachment, and a real partial-cleanup failure experiment.
- Deployed lifecycle proof remains pending the compatible template publication and fresh authenticated run.

All notable changes to Sylph are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Sylph uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Project-scoped deployment capabilities and broker-backed Alchemy state keep account credentials out of Project commands.
- Coordinated multi-Worker D1/R2 recovery with complete preflight, encrypted bucket snapshots, isolated first-release drills, and replay refusal after uncertain restores.
- Reviewed external starter v0.3.0 candidate for new Projects; publication and the new built-in pin remain pending approval. Existing Projects are unchanged.

- Production health collection on the existing schedule, release and telemetry incidents, and repair Workspaces created from the published commit.
- D1 Time Travel recovery, a drained writer gate, encrypted secret versions, and the pinned starter with all five release hooks. A real restore drill remains required before rollout.
- Multiple-Worker resource plans, hosted Durable Object and Workflow identities, service/AI bindings, and reviewed adoption, retirement, and removal.
- Browser journey requirements tied to the current Check attempt, ordered assertions, desktop/mobile viewports, allowed authentication origins, and human control.
- Concrete combined lifecycle verification actions and encrypted Installation D1 preservation with local import verification. The original preservation flow retains earlier Durable Objects; the separate migration tool now supports the pinned earlier Workspace schema.

- Browser deployment through GitHub Actions with optional custom domains, account preflight checks, stable Alchemy-managed credentials, and setup links.
- Protected browser setup for GitHub App creation or reuse, encrypted credential storage, and Installation claim without a second deployment.
- Project resource inventory, deployment ownership checks, encrypted application secrets, custom-domain configuration, and resource inspection controls.
- Production release gates for migration compatibility, saved data recovery points, and production journeys; Admin-confirmed code/data recovery with an undo point. Applications must implement the release hooks before deploying.

- Personal Cursor subscription connections through OpenCode, using encrypted OAuth credentials and a Worker-native HTTP/2 transport with per-user Durable Object isolation.

### Fixed

- Keep guarded Browser Run ownership across actions, dispose contexts on transport loss and restore page focus for screenshot evidence. The separate 79-step live fixture passes screenshots and pointer actions.
- Let Admins confirm immediate retained Preview cleanup with exact run identity, terminal Workflow verification, an audit record and resumable dispatch.

- Clean up Preview Workers and their owned D1, KV, R2, and Queue resources after failed deployments or checks. Retain deletion progress for retries and clear expired URLs without changing newer Check attempts.

- Expose Codex subscription setup, include subscription models in Workspace selection, and retry blocked Codex requests through a private Node Container. Upgrades provision an additional Container application without new secrets or migrations.

- Reuse one sandbox for checkpoint typecheck, lint, test, and build, with separate command and shared-runner timings.
- Decode provider setup inputs after server serialization before forwarding them to the Workspace runtime.
- Wait for an exact visible checkpoint/deployment DOM marker before collecting browser evidence.

### Changed

- Make checks, previews, browser evidence, automatic repair, and managed release verification optional. Saving and accepting work no longer require checks or previews; authorization and resource isolation remain enforced.
- Consolidate all pre-launch database migrations into `0001_initial.sql` for a fresh Installation. Optional release capabilities default off. No upgrade or data transfer from experimental databases is provided.
- Provision a separate resource-maintenance token and add Workers Observability Write to the managed runtime token; configured token overrides need matching permissions. See `docs/operators.md` for first-launch setup.

- Combine Website and WorkspaceRuntime into one Worker and replace pre-release database upgrades with one initial schema. Deploy to fresh resources; existing D1 and Durable Object state is not migrated.
- Resume the normal coding agent after eligible failed Checkpoints, with durable delivery and a three-Turn limit. Consolidate Workspace restart into the provisioning Workflow and browser state into one synchronization module.
- Open Workspace chat while repository and runtime setup run in a Workflow. Save early messages in D1 and deliver them in order after setup. The initial deployment includes a message delivery Workflow and a minute recovery cron.
- Remove the retired dependency-repair runner and completion callback. Dependency repairs use native shell commands.
- Reserve one production operation per Project and retain release evidence in the initial schema. Repository export declares its repository-only scope; it does not provide a full Workspace backup.
- Require a resource plan before deployment credentials are provided. The initial deployment includes the ResourceMaintenance Workflow and resource inventory. Compatible template `0.2.0` is published and pinned; see the operator notes for the remaining live checks before rollout.
- Share command environment selection, deadlines, output limits, and cancellation across agent commands and immutable Check execution.
- Use one event policy and refresh queue for Workspace synchronization; failed socket updates retain their replay cursor.
- Pin new Projects to template 0.2.0's verified commit and test that exact template release in CI. Existing Projects remain unchanged.

- Use OpenCode native file and shell tools with the existing Cloudflare Sandbox binding. Workspace edits and commands auto-approve, and consecutive tool calls appear in expandable action summaries.
- Reconcile active Workspace status after missed runtime events and accept steering messages when the previous Turn has just ended.

- Preview pages must expose `data-sylph-checkpoint` and `data-sylph-deployment` on the same visible element. See the operator upgrade notes.

## [0.1.0] - 2026-09-03

First public release.

### Added

- Operator guide in `docs/operators.md` covering the fork-based deployment model, prerequisites, created resources, cost drivers, upgrades, teardown, and troubleshooting.
- Maintainer guide in `docs/maintainers.md` covering the release procedure, the release-smoke test system, and the OAuth proxy used across preview stages.
- Setup wizard preflight stage that checks local tools, verifies the deploy token, and probes the account for a workers.dev subdomain and R2 access before deploying.
- Setup wizard captures the deployed URL from Alchemy output instead of asking for it.
- Setup wizard creates the GitHub App through GitHub's manifest flow with the callback URL and permissions pre-filled, with a manual fallback.
- Setup wizard mints a runtime API token and an R2 key pair from the deploy token, so the deployed Worker never holds a token that can create tokens.
- Issue templates, pull request template, code of conduct, Dependabot configuration, and this changelog.

### Changed

- Alchemy authenticates through the deploy token in `.env` rather than a browser login, so local deploys and GitHub Actions use the same credentials.
- Cloudflare permission names in the wizard match the names Cloudflare shows: Workers Containers Write, Browser Run Write, and Artifacts Write.
- Floating `latest` dependency ranges are pinned to the versions recorded in the lockfile.
- The OAuth proxy configuration is optional and off by default for a standalone Installation.

[Unreleased]: https://github.com/kcc989/sylph/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/kcc989/sylph/releases/tag/v0.1.0
