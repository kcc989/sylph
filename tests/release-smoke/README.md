# Release smoke test

This test exercises a fresh deployed Installation through the public browser interface:

`setup → claim → provider → Project → Workspace → prompt → permission → checkpoint → accept → eviction/restart`

Use a dedicated Cloudflare stage and GitHub OAuth application. The test intentionally fails if the Installation is already claimed.

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

Playwright stores GitHub browser state under `playwright/.auth`, which is ignored by Git. Treat that file as a credential and delete it when the test account changes. Failure traces, screenshots, video, and the JSON evidence record are stored under `test-results/release-smoke`.

The test leaves its isolated Project and Workspace in the smoke Installation as release evidence. Destroy the dedicated Alchemy stage separately after reviewing the result.
