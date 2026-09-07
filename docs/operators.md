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
- One D1 database, initialized by `packages/db/migrations/0001_initial.sql`.
- An Artifacts namespace for repositories and workspace forks.
- Two R2 buckets for check backups and evidence.
- Sandbox and Codex container applications.
- Browser Rendering and scheduled jobs.
- A runtime API token, an R2 backup token, and stable session and credential-encryption secrets.

Alchemy retains generated secret values and token outputs in its Cloudflare deployment state. Access to that state is privileged. Keep it when updating. Destroying state and generating new encryption keys does not recover existing encrypted data.

This first-release baseline requires fresh resources. It does not upgrade earlier experimental databases or transfer their Durable Object state.

## Production release safety

The initial schema stores release evidence and permits only one queued or running production operation per Project.

Before a Project production release, implement and test the application's migration, backup, restore, journey, and writer coordination hooks described in [Production releases and application data](release-safety.md). Missing hooks block production before data capture or publication. Storage permissions depend on the application's provider integrations; Sylph does not grant them automatically.

Data recovery requires an Admin to confirm the paired code commit and possible loss of writes since the selected recovery point. It creates an undo point and verifies production before reporting success. Repository exports provide Git access only; application data, secret values, and Workspace runtime state require separate recovery procedures. Validate real backup and restore behavior in an isolated stage before production rollout.

## Project resource management

This change is not ready for production rollout until its matching template
revision is published and pinned. The reviewed template patch and the complete
rollout procedure are in [the resource management guide](../tools/resource-management/README.md).
Existing Project repositories also need the new `sylph:plan` script and matching
Alchemy resource names. Sylph does not rewrite their reviewed Checkpoints.

The initial schema includes the resource inventory, and `alchemy.run.ts` provisions
the `ResourceMaintenance` Workflow in the Website Worker. The runtime token must
be able to list Workers, D1 databases, KV namespaces, R2 buckets, and Queues for
ownership checks, and delete the resources and R2 objects owned by an expired Preview. Production custom domains also require access to
the relevant account's Worker domains and zone configuration. Missing permissions
block preflight; review the existing token before rollout.

Project settings shows resource ownership, inspection results, cleanup failures,
and Admin controls for cleanup retries, application secrets, and the production
custom domain. Application secrets are encrypted and separated between Preview
and production. Configuration changes apply on the next deployment.

Existing successful production deployments without an inventory are blocked until
their resources have been reviewed and adopted. Legacy Previews without recorded
reservations are not deleted automatically. Do not infer ownership from a URL.
Run disposable deployed lifecycle checks before production rollout; the local
test suite and build do not prove live deletion or configuration behavior.

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

Existing `BETTER_AUTH_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, `CF_TOKEN`, and R2 credential overrides are supported. Supply both R2 values together. Keep overrides consistent between local deployments and Actions. Removing an override switches to Alchemy-managed credentials; do not do this for an existing Installation without planning rotation.

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
