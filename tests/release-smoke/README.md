# Release smoke test

The browser suite checks a fresh Installation:

`setup → claim → provider → Project → Workspace → prompt → auto-approved tools → checkpoint → accept → eviction/restart`

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

Preview the smoke deployments recorded in the current worktree, then remove them after approval:

```sh
bun run smoke:release:cleanup
bun run smoke:release:cleanup -- --yes
```

To discover deployed smoke stages across registered Git worktrees and remote Alchemy state, including stages whose worktrees or local records are gone:

```sh
bun run smoke:release:cleanup -- --all
bun run smoke:release:cleanup -- --all --yes
```

`--all` is scoped to the `Sylph` stack in the Cloudflare account from the saved smoke env file. It reads that Alchemy profile's cached state-store credentials and requires the account IDs to match. Discovery uses read-only HTTP requests; it does not bootstrap or upgrade the state store. It selects only validated `smoke-*` stages. If credentials are missing, stale, or rejected, discovery fails before any deletion.

The preview lists each remote stage and its source worktree, or marks it as having no local snapshot. Matching local snapshots take priority; otherwise cleanup uses the shared smoke configuration. Records from other accounts are excluded, and conflicting snapshots stop cleanup. Remote state is authoritative: stale local records do not add undeployed stages to the list. A failed deployment that left remote state is included.

All-account cleanup stores private snapshots, records, and logs under `.alchemy/smoke-cleanup/<account>/<stage>` in the current worktree. It leaves other worktrees untouched and checks that each destroyed stage disappears from remote state. Retry the same command after a failure; discovery selects stages still present. If a process is killed, verify it has stopped before removing its account-level and stage-level `cleanup.lock` directories.

This covers resources tracked in Alchemy's remote stage state. Workers with no Alchemy state, and app Previews created outside that state, still require manual recovery. It does not search other accounts or unrelated Git repositories.

To select one stage, add `--stage smoke-EXACT-STAGE` to either command. The default is a preview; only `--yes` runs Alchemy destroy. This removes the stage's Alchemy-managed resources and data. Stop active deployments and tests before cleanup.

Local cleanup uses each run's saved configuration, including for incomplete deployments, and does not require the shared env file. Both modes work without browser login or provider credits. It records successful destruction, skips completed cleanup, and continues after individual Alchemy failures. Run it again to retry unfinished stages. Private output is saved as `destroy.log` beside each run record. Run records, snapshots, and test evidence remain available locally.

Without `--all`, the scope is `.alchemy/smoke-runs` in the current worktree, including older records without branch metadata. New deployments record their branch and worktree for identification. Switching branches does not change which local records are selected. Run cleanup from each worktree before removing it; deployments with missing local records need manual recovery. This does not discover Workers created outside Alchemy's stage resources, such as app Previews.

If a cleanup process is killed, check that it has stopped before removing that run's `cleanup.lock` directory and retrying. Keep the shared credential file and GitHub browser state for future runs.

New smoke deployments set `forceDestroy` on the CheckBackups and CheckEvidence R2 buckets, so approved stage teardown can remove their objects. Other stages keep the default protection. Older deployments retain the bucket settings saved in Alchemy state; changing the source does not change those settings during destroy. If cleanup reports `BucketNotEmpty`, empty only the exact smoke-stage buckets named in that run's `destroy.log`, then retry cleanup. Do not redeploy a partially destroyed stage just to change its bucket settings.

For manual recovery of an interrupted test, invoke Playwright directly with that run's environment and set `SYLPH_SMOKE_RESUME_CLAIMED=true`, `SYLPH_SMOKE_WORKSPACE_URL`, and optionally the exact `SYLPH_SMOKE_PROOF_MARKER`. This is recovery evidence, not a fresh-Installation test. The normal runner clears these flags so stale exports cannot skip the claim test.

## Sandbox agent and D1 todo scenario

Run the same fresh-stage suite with `SYLPH_SMOKE_TODO_D1=true`:

```sh
SYLPH_SMOKE_TODO_D1=true bun run smoke:release -- --run /absolute/path/to/run.json
```

The agent must build the todo app from the Project template, use native file tools and shell commands, install dependencies, and keep meaningful verification scripts. The suite opens the deployed Preview in two independent browser contexts and checks create, reload, completion, and deletion. It also queries the Preview Worker's actual D1 binding through the Cloudflare API and attaches the observed rows and a screenshot. This scenario requires funded provider access and D1 read/query permissions on the configured Cloudflare token.

The local `smoke:runtime` suite uses a deterministic model and execution fixture to verify OpenCode's native shell dispatch through its workspace provider registry. It does not prove Cloudflare sandbox execution or replace the deployed D1 scenario.

`bun run smoke:browser` tests the agent's persistent browser service inside Cloudflare Browser Run against a disposable authenticated D1 app. It covers interactions, assertions, reload/reconnect, and session cleanup without an external Playwright browser or model credits. See [Browser Run journey smoke](../../tools/browser-smoke/README.md).

## Grok-only budgeted run

Set `SYLPH_SMOKE_GROK_BUDGET=true` on the deploy command to pin the smoke picker, titles, and compaction to OpenRouter `x-ai/grok-4.6`. The request guard rejects other models, fallbacks, media, plugins, and unbounded outputs. It reserves a conservative maximum request cost before sending each request, persists reservations across eviction, and stops at $4 per Workspace. Reservations are not refunded. This profile is for a single-Workspace run; creating another Workspace or stage creates another budget. Do not retry in a fresh Workspace without accounting for prior spending. The calculation uses $2 per million input tokens and $6 per million output tokens, counts each request byte as an input token, and adds overhead. Recheck pricing before reuse.

Use `--resume` only to continue a claimed stage. To verify an existing Workspace without generating another app, also supply `--workspace <existing URL> --proof-marker <existing marker>`. This preserves the Workspace spending ledger. Record interrupted or failed earlier attempts separately from a resumed lifecycle result.

Set `SYLPH_SMOKE_VERIFY_ONLY=true` to verify the app, Checks, and runtime recovery without approving the review, accepting the checkpoint, or archiving the Workspace. The evidence records this reduced scope; it is not full acceptance lifecycle proof.
