# Release smoke test

This test exercises a fresh deployed Installation through the public browser interface:

`setup → claim → provider → Project → Workspace → prompt → permission → checkpoint → accept → eviction/restart`

Use a fresh Cloudflare stage behind the permanent production OAuth proxy and GitHub App created by the setup wizard. The test intentionally fails if the branch Installation is already claimed.

Configure production once with `./scripts/setup.sh`. Then provision the reusable smoke credentials:

```sh
./scripts/setup-release-smoke.sh
```

Each branch stage reuses the resulting credentials and production OAuth bridge values from `~/.config/sylph/release-smoke.env`. It does not create or deploy production resources and does not require another GitHub App or callback change. Set `SYLPH_SMOKE_ENV_FILE` when the shared configuration belongs elsewhere.

The production setup wizard publishes the reusable credentials to GitHub. [Deploy production](../../.github/workflows/deploy-production.yml) deploys the fixed Alchemy `prod` stage on changes to `main` and by manual dispatch.

Alchemy reads the checkout's `.env` before the process environment, so deploy every smoke stage with the shared file instead of relying on exported variables:

```sh
bun alchemy deploy --env-file ~/.config/sylph/release-smoke.env --stage release-smoke
```

Install Chromium once:

```sh
bun run smoke:release:install
```

Set these values without committing them:

```sh
export SYLPH_SMOKE_BASE_URL="https://your-release-smoke-worker.example"
export SYLPH_SMOKE_ADMIN_EMAIL="verified-github-email@example.com"
export INSTALLATION_CLAIM_SECRET="installation-claim-secret"
export OPENROUTER_API_KEY="openrouter-api-key"
```

The optional values are `SYLPH_SMOKE_ORGANIZATION_NAME`, `SYLPH_SMOKE_PROJECT_NAME`, and `SYLPH_SMOKE_MODEL_NAME`.

Run the test headed so GitHub can request human authentication when its saved session expires:

```sh
bun run smoke:release -- --headed
```

Playwright stores GitHub browser state at `SYLPH_SMOKE_AUTH_STATE`. The setup wizard defaults it to `~/.config/sylph/release-smoke-auth.json`, so separate worktrees reuse the same login. Treat that file as a credential and delete it when the test account changes. Failure traces, screenshots, video, and the JSON evidence record are stored under `test-results/release-smoke`.

The test leaves its isolated Project and Workspace in the smoke Installation as release evidence. Destroy the dedicated Alchemy stage separately after reviewing the result.

To resume an interrupted test in the same isolated Installation, set `SYLPH_SMOKE_RESUME_CLAIMED=true` and `SYLPH_SMOKE_WORKSPACE_URL` to its existing Workspace URL. If the proof request already completed, set `SYLPH_SMOKE_PROOF_MARKER` to that request's exact marker. The test verifies the existing files and tool details before continuing with checkpoint checks and recovery.
