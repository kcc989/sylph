# Deploy your own Sylph

Deploy one Sylph Installation into your Cloudflare account. The default process runs entirely in your browser. GitHub Actions runs Bun, Docker, and Alchemy for you.

## Before you start

You need:

- A GitHub account that can create a repository and a GitHub App.
- A Cloudflare account with Workers Paid, R2 enabled, and access to Artifacts and Containers.
- A registered `workers.dev` subdomain under **Workers & Pages**.
- For a custom hostname, an active DNS zone in the same Cloudflare account.

The first deployment can take several minutes while container images are uploaded. Model provider credentials are added inside Sylph after setup.

## 1. Create your repository

[Fork Sylph](https://github.com/kcc989/sylph/fork). Open the fork's **Actions** tab and enable workflows if GitHub asks.

Your repository contains the deployment code. Secrets stay outside Git. Keep the repository, Cloudflare account, and `prod` stage when updating so Alchemy can reuse existing resources and credentials.

## 2. Connect Cloudflare

In Cloudflare, open **Workers & Pages** and copy the Account ID. Then open **Manage Account → Account API Tokens**, create a custom account token named **Sylph deploy**, and limit it to this account.

Grant these account permissions:

- Account Settings Read
- Account API Tokens Write
- Workers Scripts Write
- Workers Observability Write
- D1 Write
- Workers R2 Storage Write
- Workers KV Storage Write
- Queues Write
- Workers Containers Write
- Workers CI Write
- Workers AI Read and Workers AI Write
- Artifacts Write
- Browser Run Write

For a custom domain, also grant **Zone Read** and **DNS Read**, limited to its zone. The deploy token creates narrower runtime and backup tokens. The deploy token itself is never put in the Sylph Worker.

In your GitHub fork, open **Settings → Secrets and variables → Actions**. Add:

| Tab       | Name                        | Value                                      |
| --------- | --------------------------- | ------------------------------------------ |
| Variables | `CLOUDFLARE_ACCOUNT_ID`     | Your Cloudflare Account ID                 |
| Secrets   | `CLOUDFLARE_API_TOKEN`      | The deploy token                           |
| Secrets   | `INSTALLATION_CLAIM_SECRET` | A new random setup code, 32–256 characters |

Generate the setup code with your password manager and save a copy there. GitHub does not show saved secret values again. You will enter this code once in Sylph to prove you control the deployment.

Use repository variables for the account ID and domain, rather than environment variables. The workflow uses the account ID to distinguish configured forks from new ones.

## 3. Choose your address

For a Cloudflare address, do nothing. Sylph uses its `workers.dev` address.

For a custom address, add one repository variable:

| Name           | Example             |
| -------------- | ------------------- |
| `SYLPH_DOMAIN` | `sylph.example.com` |

Enter only the hostname: no `https://`, path, or wildcard. The zone must be active in your Cloudflare account. Choose a hostname without an existing CNAME record. Alchemy attaches the custom domain; Cloudflare manages its DNS record and certificate.

Sylph uses this address for authentication, GitHub callbacks, and links. Requests to the Worker's other address redirect to the primary address before sign-in.

## 4. Deploy

Open **Actions → Deploy production → Run workflow**, select `main`, and run it.

The workflow:

1. Checks the deploy token, `workers.dev` registration, R2, Artifacts, and any custom hostname.
2. Runs code checks and builds Sylph.
3. Creates the resources and credentials through Alchemy.
4. Adds **Open Sylph** and **Finish setup** links to the run summary.

Open **Finish setup**. If a step fails, correct the reported problem and rerun the workflow. Completed resources and saved credentials are reused. A failed deploy does not mean you need a new token or another GitHub App.

## 5. Finish in Sylph

1. Enter the setup code you saved earlier.
2. Choose **Create GitHub App**. Give it a unique name and confirm GitHub's prefilled permissions. To reuse an App, expand **Connect an existing GitHub App** instead.
3. Follow **Install GitHub App** and select the repositories Sylph may access.
4. Choose **Continue with GitHub**.
5. Confirm your verified email address and name your Organization. Claim the Installation.
6. Connect a model provider in Admin, then create your first Project and Workspace.

GitHub App credentials are encrypted in D1. No second deployment or copying credentials to GitHub Actions is needed. Setup progress survives reloads. After an hour, re-enter the setup code to continue. Once claimed, the setup code can no longer change the GitHub connection.

## What is created

- One Website Worker hosting the app, Durable Objects, Workflows, and container bindings.
- One D1 database, initialized and updated by the ordered migrations in `packages/db/migrations`.
- An Artifacts namespace for repositories and workspace forks.
- Two R2 buckets for check backups and evidence.
- Sandbox and Codex container applications.
- Browser Rendering and scheduled jobs.
- A runtime API token, a separate resource-maintenance token, an R2 backup token, and stable session and credential-encryption secrets.

Alchemy retains generated secret values and token outputs in its Cloudflare deployment state. Access to that state is privileged. Keep it when updating. Destroying state and generating new encryption keys does not recover existing encrypted data.

The first-release baseline requires fresh resources. This update applies `0002_project_operations.sql` and then `0003_resource_lifecycle.sql` to that baseline. The migrations preserve existing resource claims and add production observations, repair references, and resource lifecycle reviews. They do not convert earlier experimental schemas or transfer Durable Object state. Deploy this release as a fresh Installation. Earlier experimental Installations will be discarded; no data transfer is required.

## Production release safety

The initial schema stores release evidence and permits only one queued or running production operation per Project.

Before a Project production release, implement and test the application's migration, backup, restore, journey, and writer coordination hooks described in [Production releases and application data](release-safety.md). The pinned `0.2.0` starter supplies these hooks for one Worker and one application D1 database, with a separate retained recovery-control D1 database. Its first release also requires a real provider restore drill for the application schema. Other stateful topologies need tested adapters. Missing hooks or drill evidence block production; storage permissions depend on those adapters.

Data recovery requires an Admin to confirm the paired code commit and possible loss of writes since the selected recovery point. It creates an undo point and verifies production before reporting success. Repository exports provide Git access only; application data, secret values, and Workspace runtime state require separate recovery procedures. Validate real backup and restore behavior in an isolated stage before production rollout.

## Project resource management

The previous template `0.2.0` remains published and pinned while the v0.3.0 candidate awaits approval. Complete the candidate publication, pin update and live lifecycle
checks before production rollout. The external template release and rollout
procedure are in [the resource management guide](../tools/resource-management/README.md).
Existing Project repositories also need the new `sylph:plan` script and matching
Alchemy resource names. Sylph does not rewrite their reviewed Checkpoints.

The initial schema includes the resource inventory, and `alchemy.run.ts` provisions
the `ResourceMaintenance` Workflow in the Website Worker. The separate resource-maintenance token must
be able to inspect Workers, D1 databases, KV namespaces, R2 buckets, Queues, and hosted Durable Objects and Workflows for
ownership checks, and delete the resources and R2 objects owned by an expired Preview. Production custom domains also require access to
the relevant account's Worker domains and zone configuration. Missing permissions
block preflight; review the existing token before rollout.

Project settings shows resource ownership, inspection results, cleanup failures,
and Admin controls for reviewed adoption, retirement, removal, cleanup retries,
application secrets, and the production custom domain. Application secrets are encrypted and separated between Preview
and production. Configuration changes apply on the next deployment.

Existing successful production deployments without an inventory are blocked until
their resources have been reviewed and adopted. Legacy Previews without recorded
reservations are not deleted automatically. Do not infer ownership from a URL.
Run disposable deployed lifecycle checks before production rollout; the local
test suite and build do not prove live deletion or configuration behavior.

## Deployment isolation and recovery upgrades

Apply the ordered `0004_project_deployment_broker.sql` and `0005_project_preview_cleanup.sql` migrations through the normal Alchemy deployment. They add expiring deployment capabilities, scoped Alchemy state and Preview cleanup audit records. No new manual credential is required. Keep the Installation credential encryption key unchanged.

Project CI now uses the Installation broker for Cloudflare operations and Alchemy state. The starter v0.3.0 candidate lives in the external template repository; `tools/resource-management/template-candidate.json` records its exact commit and verification metadata. Publication and the built-in pin update are pending approval. Template pin changes affect new Projects only; existing Project source and accepted Checkpoints remain unchanged. See [candidate procedure](../tools/template-contract/README.md).

The new starter retains a separate D1 drill database and, when R2 is declared, a separate R2 drill bucket. Their purpose is `recovery_control`; application cleanup and restore exclude them. First release checks initial Worker absence before migrations, runs isolated provider drills, then records the complete D1/R2 recovery group. Recovery requires guarded writers and inactive object-changing bucket policies. A failed or uncertain restore leaves the writer gate paused for inspection. Local tests do not establish live Time Travel or R2 metadata compatibility.

An Admin can confirm immediate cleanup of a retained Preview in Project settings. The confirmation names the exact scope and run. Cleanup stops only a retention-waiting Workflow, independently checks its terminal state and saves an audit record before dispatch. Failed cleanup can be retried after its prior Workflow finishes. Production and recovery-control resources remain excluded.

## Production observations and browser acceptance

Alchemy adds Workers Observability Write to its managed runtime token. A manually supplied `CF_TOKEN` needs that permission and Worker script access before health collection can work. Application Workers must enable invocation logs. The pinned starter does so; older deployed applications require a new reviewed release with logging and recorded deployment identity.

The minute schedule collects up to three eligible Projects, starting with the oldest observation, at least five minutes apart per Project. Manual collection is limited to once a minute. Production health tracks the latest published release, including releases that fail after publication. Release failures remain actionable when telemetry is unknown; they do not turn unknown telemetry into a health result. Members can acknowledge incidents and create a repair Workspace at the recorded deployed commit. Notifications remain inside Sylph. See [production operations](verification/project-operations.md) for sampling limits.

Browser acceptance can require ordered application assertions at desktop and mobile sizes. The saved policy, current Check attempt, evidence, and any human exception are recorded together. Set allowed origins explicitly for application authentication. See [browser testing](browser-testing.md) for browser control, evidence requirements, and service limits.

## Update Sylph

Review upstream changes, sync your fork, and push to `main`. The same workflow deploys the update. You can also run **Deploy production** manually.

Keep the Cloudflare account, stage, and saved setup code unchanged. Generated credentials remain in Alchemy state; the GitHub connection remains in D1. Do not delete either to retry a failed update.

## Add or change a custom domain later

1. Open your GitHub App's settings. Add `https://new-hostname/api/auth/callback/github` to its user authorization callback URLs. Keep the current callback until you verify the new address.
2. Ensure the new zone is active and the deploy token can read the zone and DNS records.
3. Set `SYLPH_DOMAIN` in your repository variables, then run **Deploy production**.
4. Open the new address and verify GitHub sign-in. Cookies belong to the old origin, so sign in again.
5. Update the App's homepage URL. Remove the old OAuth callback after verification.

A move from `workers.dev` keeps that endpoint as a redirect to the custom domain. Changing between two custom domains removes the old Alchemy-managed attachment; arrange an explicit redirect for the old custom hostname if you need one. To return to `workers.dev`, add its OAuth callback to your GitHub App first, then remove `SYLPH_DOMAIN` and redeploy. Alchemy removes the old custom-domain attachment.

## Local alternative

Clone your fork, install Bun and Docker, start Docker, and run:

```sh
./scripts/setup.sh
```

The five stages prepare your machine, connect Cloudflare, save a setup code, deploy, and optionally configure GitHub Actions. Finish GitHub connection and claim in the same browser setup screen. Existing `.env` values are reused. GitHub CLI authentication is needed only to publish settings automatically.

To check configuration or deploy later:

```sh
bun run deploy:check
bun alchemy deploy --stage prod
```

## Advanced configuration

Existing `BETTER_AUTH_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, `CF_TOKEN`, `RESOURCE_TOKEN`, and R2 credential overrides are supported. Supply both R2 values together. Keep overrides consistent between local deployments and Actions. Removing an override switches to Alchemy-managed credentials; do not do this for an existing Installation without planning rotation. Without a `RESOURCE_TOKEN` override, Alchemy creates the resource token automatically; no new manual credential is required. Installation resource and CI tokens remain account-scoped inside Installation services. Project commands receive only an expiring capability for their exact active resource plan; they do not receive either account token. Application recovery and verification keys are derived from the retained Installation encryption key; changing that key breaks access to saved recovery secrets.

`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` can supply an existing connection when D1 has no saved App. A connection saved through `/setup` takes precedence.

Preview OAuth proxies are optional. Configure `OAUTH_PROXY_URL`, `OAUTH_PROXY_SECRET`, and `OAUTH_PROXY_TRUSTED_ORIGINS` together only when this Installation serves previews. See [release smoke testing](../tests/release-smoke/README.md). Normal setup does not require a proxy, Playwright, or model credits.

`ALLOW_TEST_MAGIC_LINKS` is disabled by production Actions. Never enable it for a public Installation. `CI_VERIFICATION_CONCURRENCY` defaults to two. See [sandbox execution limits](sandbox-agent.md), [Cursor verification](smoke-tests/cursor-provider.md), and [Codex verification](../tools/codex-smoke/README.md) for runtime details.

## Workspace recovery and execution

Workspace restarts use the provisioning Workflow and retain restart requests across retries. Restart validates the selected provider credentials before evicting the runtime.

Eligible failed Checkpoints resume the normal coding agent automatically, up to three continuations. A passing Check or a new user message resets the limit. Production Checks do not start automatic repairs. Completion delivery survives runtime restarts and does not start a second Turn for the same delivered result.

Dependency repairs use native shell commands. Correct dependency failures with `bun install`, then run `workspace_run_checks` to create and verify a normal Checkpoint. Agent and Check commands share limits of ten minutes and eight MiB of captured output per command. Check verification does not receive deployment credentials.

New Projects use the exact template commit in `packages/domain/src/template-release.ts`. CI checks that revision with its recorded Bun version. The importer rejects any head that differs from the release commit. Existing Projects are not changed. Update the release record only after the replacement template passes its contract checks.

## Troubleshooting

**Missing configuration.** Add the named repository variable or secret. Setup codes must contain 32–256 characters.

**Cloudflare returns 403.** Check the token's account and permissions. A custom domain also requires access to its zone. Artifacts must be enabled for the account.

**Container creation fails.** Check Workers Paid and Containers availability. Inspect the failed Actions step; do not create a replacement Installation to retry.

**GitHub App creation was interrupted.** Return to `/setup`. Reuse the App through **Connect an existing GitHub App** if GitHub already created it. Its Client ID and a client secret are available in the App's settings.

**GitHub sign-in fails.** Verify that the App's callback URL matches the primary address followed by `/api/auth/callback/github`. Check the App's repository installation and OAuth settings. Before claiming, you can replace an incorrect connection in `/setup`.

**Setup code expired.** The browser session expires after an hour; the saved setup code does not. Enter it again. Claimed Installations no longer accept setup changes.

**The local deploy uses the wrong Cloudflare credentials.** Run `CI=true bunx alchemy login --configure` to select environment-token authentication. The wizard and Actions do this automatically.

## Teardown

`bun alchemy destroy --stage prod` deletes the Installation's managed resources, including databases, storage, and generated credentials. Run it only when you intend to discard the Installation. Delete the GitHub App and revoke any manually supplied deploy or runtime tokens separately.
