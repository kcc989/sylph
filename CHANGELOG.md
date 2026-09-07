# Changelog

All notable changes to Sylph are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Sylph uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Project resource inventory, deployment ownership checks, encrypted application secrets, custom-domain configuration, and resource inspection controls.

- Personal Cursor subscription connections through OpenCode, using encrypted OAuth credentials and a Worker-native HTTP/2 transport with per-user Durable Object isolation.

### Fixed

- Clean up Preview Workers and their owned D1, KV, R2, and Queue resources after failed deployments or checks. Retain deletion progress for retries and clear expired URLs without changing newer Check attempts.

- Expose Codex subscription setup, include subscription models in Workspace selection, and retry blocked Codex requests through a private Node Container. Upgrades provision an additional Container application without new secrets or migrations.

- Reuse one sandbox for checkpoint typecheck, lint, test, and build, with separate command and shared-runner timings.
- Decode provider setup inputs after server serialization before forwarding them to the Workspace runtime.
- Wait for an exact visible checkpoint/deployment DOM marker before collecting browser evidence.

### Changed

- Require a resource plan before deployment credentials are provided. Upgrades need migration 0024, the ResourceMaintenance Workflow, and a compatible published template revision; the template update is currently included as a patch and the existing pin is unchanged. See the operator upgrade notes before rollout.

- Resume the normal coding agent after eligible failed Checkpoints, with durable delivery and a three-Turn limit. Consolidate Workspace restart into the provisioning Workflow and browser state into one synchronization module. Upgrades apply migration 0023 without new secrets.
- Open Workspace chat while repository and runtime setup run in a Workflow. Save early messages in D1 and deliver them in order after setup. Upgrades add migration 0022, a message delivery Workflow, and a minute recovery cron without new secrets.
- Remove the retired dependency-repair runner and completion callback. Existing results remain readable; resumed dependency jobs fail with instructions to use native `bun install`. Finish any active dependency jobs before upgrading. No new secrets or database migrations are required.
- Share command environment selection, deadlines, output limits, and cancellation across agent commands and immutable Check execution.
- Use one event policy and refresh queue for Workspace synchronization; failed socket updates retain their replay cursor.
- Pin new Projects to template 0.1.1's verified commit and test that exact template release in CI. Existing Projects remain unchanged.

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
