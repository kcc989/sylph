# Release smoke test

The browser suite checks a fresh Installation:

`setup → claim → provider → Project → Workspace → prompt → permission → checkpoint → accept → eviction/restart`

Use Node 24, the checked-in dependencies (`bun install --frozen-lockfile`), for deployment. Install Chromium (`bun run smoke:release:install`) only for the optional browser suite. Run commands from the repository root.

## Repeatable branch deployment

The runner reads `~/.config/sylph/release-smoke.env` automatically. Set `SYLPH_SMOKE_ENV_FILE` to use another file. Do not source it, copy it into `.env`, or export individual credentials. Each deployment gets a private snapshot passed explicitly to Alchemy and reused by Playwright. Saved configuration wins over shell values.

Choose the deployed sign-in mode:

```sh
bun run smoke:release:doctor -- --auth magic
bun run smoke:release:deploy -- --auth magic
```

`magic` supports manual or automated runtime verification without a human GitHub login. It enables the existing test magic-link flow only on the isolated stage and clears GitHub/proxy settings in the deployment snapshot. It does not verify GitHub OAuth. Never enable it on production.

The deploy command creates a unique `smoke-*` stage and prints its URL. Open that URL in your browser to verify the app. Deployment does not require Playwright, a saved GitHub browser session, or provider credits. To run the optional automated regression suite, use the printed command:

```sh
bun run smoke:release -- --run /absolute/path/to/.alchemy/smoke-runs/smoke-.../run.json
```

The run record contains the stage, source commit, dirty-checkout flag, auth mode, deployed URL, and configuration snapshot path. The private deployment log is beside it. An existing local run directory cannot be overwritten. For each fresh claim test, deploy a new stage. Do not reuse the old `SYLPH_SMOKE_STAGE` or `SYLPH_SMOKE_BASE_URL` from the shared file.

The doctor checks deployment configuration, proxy consistency, and Cloudflare account access. It does not run the browser suite or check OpenRouter. Deployment still verifies resource permissions and configuration at runtime.

The optional browser suite checks its own admin email, provider key, available credit information, and Playwright session before starting. The [account credits endpoint](https://openrouter.ai/docs/api/api-reference/credits/get-credits) may require a management key; when access is denied, the runner reports that account balance is unverified. An unlimited key limit does not mean the account has funds. A positive balance does not guarantee enough credit for the full test.

## GitHub OAuth proof

GitHub is the default auth mode:

```sh
bun run smoke:release:doctor
bun run smoke:release:deploy
```

For automated verification, add `--headed` to the printed test command and complete GitHub login in the headed Playwright browser. Later runs can omit `--headed` while that GitHub session remains usable. A headless login times out after one minute with the failing browser trace; a headed login allows ten minutes.

`gh auth login`, the Codex browser, Chrome, and Playwright have separate sessions. A saved Sylph cookie for an old stage cannot sign in to GitHub or a fresh stage. The browser preflight rejects headless GitHub runs with no unexpired GitHub session cookie. A cookie can also be revoked server-side, which only the live login can detect.

The GitHub mode requires `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `OAUTH_PROXY_URL`, `OAUTH_PROXY_SECRET`, and `OAUTH_PROXY_TRUSTED_ORIGINS`. Use the existing permanent proxy and its GitHub App. Do not change the production callback for each branch. The proxy must trust the new stage's origin. See [the maintainer guide](../../docs/maintainers.md#oauth-across-preview-stages).

If the existing App and proxy values live in another env file, set `SYLPH_SMOKE_GITHUB_ENV_FILE` or pass `--github-env /absolute/path/to/existing.env` to doctor and deploy. The runner fills only missing GitHub/proxy values, preserves smoke-file values, and never imports the other file's Cloudflare account or infrastructure credentials. It does not create an App or change its callback. The selected values are saved in the run snapshot, so the test needs no second configuration file.

The legacy `OAUTH_PROXY` key is accepted as `OAUTH_PROXY_URL`; conflicting values fail. The runner never edits the shared file or guesses missing GitHub secrets. For initial manual credential setup, run `scripts/setup-release-smoke.sh`. It reuses existing values.

Browser state defaults beside the shared env file, at `release-smoke-auth.json`, or uses `SYLPH_SMOKE_AUTH_STATE`. Treat it as a credential. GitHub tests save it with restricted permissions; magic-link runs neither load nor overwrite it. Do not run GitHub tests concurrently against the same state file.

## Evidence and cleanup

Failure traces, screenshots, video, and test evidence are under `test-results/release-smoke/<stage>`; the HTML report is under `playwright-report/release-smoke/<stage>`. These may contain credentials and application data. Keep them local. The runner retains the isolated stage for review and never destroys resources automatically.

After explicit approval to remove that stage, use the stage and snapshot from its run record:

```sh
bun alchemy destroy --env-file /absolute/path/to/deploy.env --stage smoke-EXACT-STAGE --yes
```

Then remove that run's local directory. Keep the shared credential file and GitHub browser state for future runs.

For manual recovery of an interrupted test, invoke Playwright directly with that run's environment and set `SYLPH_SMOKE_RESUME_CLAIMED=true`, `SYLPH_SMOKE_WORKSPACE_URL`, and optionally the exact `SYLPH_SMOKE_PROOF_MARKER`. This is recovery evidence, not a fresh-Installation test. The normal runner clears these flags so stale exports cannot skip the claim test.
