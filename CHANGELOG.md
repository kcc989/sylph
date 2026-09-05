# Changelog

All notable changes to Sylph are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Sylph uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Personal Cursor subscription connections through OpenCode, using encrypted OAuth credentials and a Worker-native HTTP/2 transport with per-user Durable Object isolation.

### Fixed

- Expose Codex subscription setup, include subscription models in Workspace selection, and retry blocked Codex requests through a private Node Container. Upgrades provision an additional Container application without new secrets or migrations.

- Reuse one sandbox for checkpoint typecheck, lint, test, and build, with separate command and shared-runner timings.
- Decode provider setup inputs after server serialization before forwarding them to the Workspace runtime.
- Wait for an exact visible checkpoint/deployment DOM marker before collecting browser evidence.

### Changed

- New built-in template imports use `main` instead of the `v0.1.0` tag. Existing Projects remain independent copies.
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
