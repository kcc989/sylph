# Maintaining Sylph

This guide is for people who publish releases and run the shared test infrastructure. Operators of a single Installation should read [the operator guide](operators.md).

## Releasing

1. Move the `Unreleased` entries in `CHANGELOG.md` under a new version heading with today's date. List required operator actions.
2. Set `version` in the root `package.json` to match.
3. For code releases, merge to `main` and confirm the `Test` workflow passes. Run **Deploy production** for the intended Installation and verify the deployment. Documentation-only changes do not trigger these workflows.
4. Tag and publish:

```sh
git tag -a v0.1.0 -m "Sylph 0.1.0"
git push origin v0.1.0
gh release create v0.1.0 --title "Sylph 0.1.0" --notes-file <(sed -n '/^## \[0.1.0\]/,/^## \[/p' CHANGELOG.md | sed '$d')
```

Keep published tags unchanged so issue reports identify the same source.

## Release smoke tests

Use the [release smoke runbook](../tests/release-smoke/README.md). The runner loads `~/.config/sylph/release-smoke.env`, checks credentials, creates a unique stage, and records the exact deployed URL and configuration for the browser suite:

```sh
bun run smoke:release:doctor -- --auth magic
bun run smoke:release:deploy -- --auth magic
```

Open the printed URL for manual verification. The optional browser suite uses the printed test command. Deployment needs neither Playwright nor provider credits. Use the default GitHub mode and add `--headed` to the test command when testing OAuth. Reuse an existing App configuration with `SYLPH_SMOKE_GITHUB_ENV_FILE` when its values live outside the shared smoke file. Magic-link mode does not test GitHub OAuth. `gh auth` does not authenticate Playwright.

`scripts/setup-release-smoke.sh` is the one-time manual credential wizard. Existing credentials are reused across worktrees. Never rely on exported variables to override a checkout's `.env`; the runner passes a private snapshot through Alchemy's `--env-file` flag.

## OAuth across preview stages

Use Better Auth's OAuth Proxy to give changing branch and smoke-stage URLs a stable GitHub callback. Configure one permanent Sylph stage as the proxy and register its callback URL with the existing GitHub App:

```text
https://your-permanent-proxy.example/api/auth/callback/github
```

Set the following values on the permanent stage and every participating preview stage:

```sh
OAUTH_PROXY_URL=https://your-permanent-proxy.example
OAUTH_PROXY_SECRET=one-shared-random-secret-with-at-least-32-characters
OAUTH_PROXY_TRUSTED_ORIGINS=https://sylph-*.your-test-domain.example
```

Keep `OAUTH_PROXY_TRUSTED_ORIGINS` limited to domains controlled by the test system. Use a separate proxy secret. When these values are absent, Sylph uses the direct GitHub OAuth flow of a standalone Installation. Set proxy values in the private deployment environment or Actions settings.

## Local development

Local development runs the Cloudflare-backed app through Alchemy's dev mode and needs Docker running for the sandbox container:

```sh
bun install --frozen-lockfile
bun run dev:cloudflare -- --stage dev
```

Set `ALLOW_TEST_MAGIC_LINKS=true` in `.env` to sign in without GitHub. Requested magic links are stored in `magic_link_outbox` and the latest link is shown on the sign-in screen.
