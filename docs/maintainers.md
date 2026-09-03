# Maintaining Sylph

This guide is for people who publish releases and run the shared test infrastructure. Operators of a single Installation should read `docs/operators.md` instead.

## Releasing

1. Move the `Unreleased` entries in `CHANGELOG.md` under a new version heading with today's date. Call out anything an operator must do during the upgrade.
2. Set `version` in the root `package.json` to match.
3. Merge to `main` and confirm the `Test` and `Deploy production` workflows pass.
4. Tag and publish:

```sh
git tag -a v0.1.0 -m "Sylph 0.1.0"
git push origin v0.1.0
gh release create v0.1.0 --title "Sylph 0.1.0" --notes-file <(sed -n '/^## \[0.1.0\]/,/^## \[/p' CHANGELOG.md | sed '$d')
```

Operators pin to tags when they report issues, so never move a published tag.

## Release smoke tests

`scripts/setup-release-smoke.sh` provisions a disposable Installation used by the Playwright suite in `tests/release-smoke`. It needs its own Cloudflare account or a clearly separated stage, an OpenRouter key, and the OAuth proxy described below. Run the suite with:

```sh
bun run smoke:release:install
bun run smoke:release
```

The smoke environment is loaded from `~/.config/sylph/release-smoke.env` with Alchemy's `--env-file` flag. Alchemy prefers the repository's `.env` over exported variables, so pass the file explicitly rather than exporting values.

## OAuth across preview stages

GitHub Apps accept one callback URL, so branch and smoke-test deployments with changing URLs cannot each register their own. Use Better Auth's OAuth Proxy: deploy one permanent Sylph stage as the proxy and register only its callback URL with GitHub:

```text
https://your-permanent-proxy.example/api/auth/callback/github
```

Set the following values on the permanent stage and every participating preview stage:

```sh
OAUTH_PROXY_URL=https://your-permanent-proxy.example
OAUTH_PROXY_SECRET=one-shared-random-secret-with-at-least-32-characters
OAUTH_PROXY_TRUSTED_ORIGINS=https://sylph-*.your-test-domain.example
```

Keep `OAUTH_PROXY_TRUSTED_ORIGINS` limited to domains controlled by the test system. Use a dedicated proxy secret instead of sharing `BETTER_AUTH_SECRET`. When these values are absent, Sylph uses the direct GitHub OAuth flow of a standalone Installation. The production setup wizard asks whether the Installation should act as a proxy and leaves all three values empty when the answer is no.

## Local development

Local development runs the Cloudflare-backed app through Alchemy's dev mode and needs Docker running for the sandbox container:

```sh
bun install --frozen-lockfile
bun run dev:cloudflare -- --stage dev
```

Set `ALLOW_TEST_MAGIC_LINKS=true` in `.env` to sign in without GitHub. Requested magic links are stored in `magic_link_outbox` and the latest link is shown on the sign-in screen.
