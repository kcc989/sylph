# Deploy your own Sylph

Deploy Sylph into your Cloudflare account through GitHub Actions. You need only a browser; Actions runs Bun, Docker, and Alchemy.

## Before you start

You need:

- A GitHub account that can create a repository and a GitHub App.
- A Cloudflare account with Workers Paid, R2 enabled, and access to Artifacts and Containers.
- A registered `workers.dev` subdomain under **Workers & Pages**.
- For a custom hostname, an active DNS zone in the same Cloudflare account.

The first deployment can take several minutes to upload container images. Add model provider credentials in Sylph after setup.

## 1. Create your repository

[Fork Sylph](https://github.com/kcc989/sylph/fork). Open the fork's **Actions** tab and enable workflows if GitHub asks.

Keep secrets out of Git. When updating, use the same repository, Cloudflare account, and `prod` stage so Alchemy reuses resources and credentials.

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

For a custom domain, also grant **Zone Read** and **DNS Read**, limited to its zone. Alchemy uses the deploy token to create more restricted runtime and backup tokens. It does not store the deploy token in the Worker.

In your GitHub fork, open **Settings → Secrets and variables → Actions**. Add:

| Tab       | Name                        | Value                                      |
| --------- | --------------------------- | ------------------------------------------ |
| Variables | `CLOUDFLARE_ACCOUNT_ID`     | Your Cloudflare Account ID                 |
| Secrets   | `CLOUDFLARE_API_TOKEN`      | The deploy token                           |
| Secrets   | `INSTALLATION_CLAIM_SECRET` | A new random setup code, 32–256 characters |

Generate and save the setup code in your password manager. GitHub will not show it again. Enter it in Sylph to prove you control the deployment.

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

Open **Finish setup**. If deployment fails, fix the reported problem and rerun the workflow. It reuses created resources and saved credentials; keep the existing token and GitHub App unless they caused the failure.

## 5. Finish in Sylph

1. Enter the setup code you saved earlier.
2. Choose **Create GitHub App**. Give it a unique name and confirm GitHub's prefilled permissions. To reuse an App, expand **Connect an existing GitHub App** instead.
3. Follow **Install GitHub App** and select the repositories Sylph may access.
4. Choose **Continue with GitHub**.
5. Confirm your verified email address and name your Organization. Claim the Installation.
6. Connect a model provider in Admin, then create your first Project and Workspace.

Sylph encrypts GitHub App credentials in D1. You do not need another deployment or Actions secrets. Setup survives reloads; after an hour, re-enter the setup code. Once claimed, the Installation no longer accepts GitHub connection changes through that code.

## What is created

- One Website Worker hosting the app, Durable Objects, Workflows, and container bindings.
- One D1 database, initialized by `packages/db/migrations/0001_initial.sql`.
- An Artifacts namespace for repositories and workspace forks.
- Two R2 buckets for check backups and evidence.
- Separate workspace and CI Sandbox containers, plus Cursor and Codex provider containers.
- Browser Run and scheduled jobs.
- A runtime API token, a separate resource-maintenance token, an R2 backup token, and stable session and credential-encryption secrets.

Alchemy stores generated secrets and tokens in its Cloudflare deployment state. Protect and retain that state during updates. New encryption keys cannot decrypt existing data.

Create a fresh Installation. `0001_initial.sql` creates the complete database; it cannot upgrade earlier experimental schemas. To retain an earlier Installation, follow the [preservation procedure](installation-transition.md). Do not apply this baseline to its database.

## Production release safety

Only one production operation may be queued or running per Project. A basic release builds and deploys an Accepted commit with access and resource ownership checks. Managed recovery and application verification are optional; browser evidence is a separate option. For managed recovery, implement and test the commands in [Production releases and application data](release-safety.md).

An Admin must confirm the code commit and possible loss of later writes before data recovery. Recovery creates an undo point and verifies production before reporting success. Repository exports contain Git access only; data, secrets, and Workspace runtime state need separate recovery procedures. Test backup and restore in an isolated stage before production use.

## Project resource management

The built-in template is pinned in [template-release.ts](../packages/domain/src/template-release.ts). Pin changes affect new Projects only. See [templates](project-templates.md) for imports and releases and [resource management](../tools/resource-management/README.md) for ownership and cleanup. Project repositories need `sylph:plan` and matching Alchemy resource names.

`ResourceMaintenance` runs in the app Worker. Its token must inspect Workers, D1, KV, R2, Queues, and hosted Durable Objects and Workflows. It also needs permission to delete resources and R2 objects owned by expired Previews. Custom domains require Worker domain and zone access. Missing permissions stop preflight.

Project settings shows resource ownership, inspections, and cleanup failures. Admins can review adoption, retirement, removal, and cleanup retries, and set application secrets and the production domain. Preview and production secrets are encrypted separately. Changes apply on the next deployment.

Production deployments without an inventory require resource review and adoption. Older Previews without reservations are not deleted automatically. A URL does not prove ownership. Test deletion and configuration on disposable deployed resources before production use.

## Deployment isolation and recovery

Alchemy creates storage for deployment capabilities, scoped state, and cleanup audit records with the Installation. No additional manual credential is required. Keep the credential encryption key unchanged.

Project CI uses the Installation broker for Cloudflare operations and Alchemy state. The release pin selects the template commit; candidate metadata only records a review. See [the template release procedure](../tools/template-contract/README.md).

Managed recovery stores its records in a separate D1 database marked `recovery_control`. Application cleanup and restore exclude it. Before using recovery, complete the provider restore tests in the [recovery guide](../packages/cloudflare-recovery/README.md) and follow the [release requirements](release-safety.md#managed-storage-requirements). Failed or uncertain restores keep application writes paused.

An Admin can request immediate Preview cleanup by confirming its scope and run. Cleanup can stop a Workflow only while it waits for retention to expire. It verifies that the Workflow has stopped and records the request before dispatch. Retry failed cleanup after its prior Workflow finishes. Production and recovery-control resources are excluded.

## Production observations and browser acceptance

Alchemy-managed runtime tokens include Workers Observability Write. A supplied `CF_TOKEN` needs that permission and Worker script access. Application Workers must enable invocation logs and record deployment identity. Older applications need a reviewed release that adds them.

Each minute, Sylph collects observations for up to three Projects, oldest first, with at least five minutes between collections per Project. Manual collection is limited to once a minute. Health follows the latest published release, even if it later failed. A release failure remains visible when telemetry is unknown. Members can acknowledge incidents and create repair Workspaces at the deployed commit. Notifications stay in Sylph. See [production operations](project-operations.md) for sampling limits.

Users can require ordered browser assertions at desktop and mobile sizes before Acceptance. Sylph records the policy, Check attempt, evidence, and any User exception. Configure allowed origins for application sign-in. See [browser testing](browser-testing.md).

## Update Sylph

Review upstream changes, sync your fork, and push to `main`. Changes to deployment inputs trigger the workflow; documentation-only changes do not. You can also run **Deploy production** manually.

Keep the Cloudflare account, stage, and saved setup code unchanged. Generated credentials remain in Alchemy state; the GitHub connection remains in D1. Do not delete either to retry a failed update.

The web/runtime split adds a private, service-bound `Web` Worker. The existing `Website` Worker retains the public address, Durable Objects, Workflows, containers, and schedules. Deploy through `alchemy.run.ts` with the existing account and stage to retain those identities. This update requires no new manual secrets or database migration. Docker must be available to build the CI image, which adds the supported `tsx` loader for brokered Alchemy commands. Do not transfer or recreate runtime resources as part of this update.

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

You can override `BETTER_AUTH_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, `CF_TOKEN`, and R2 credentials locally and in Actions. Supply both R2 values together and keep supported overrides consistent. Removing an override switches to Alchemy-generated credentials; plan rotation before doing this on an existing Installation.

`RESOURCE_TOKEN` can be supplied in a private local deployment environment. The shipped Actions workflow does not forward that override and uses an Alchemy-generated token. Do not assume an Actions secret named `RESOURCE_TOKEN` changes this behavior.

Account-scoped tokens stay in Installation services. Project commands receive an expiring capability restricted to their active resource plan. Recovery and verification keys derive from the Installation encryption key; changing it prevents access to saved recovery secrets.

`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` can supply an existing connection when D1 has no saved App. A connection saved through `/setup` takes precedence.

Preview OAuth proxies are optional. Configure `OAUTH_PROXY_URL`, `OAUTH_PROXY_SECRET`, and `OAUTH_PROXY_TRUSTED_ORIGINS` together only when this Installation serves previews. See [release smoke testing](../tests/release-smoke/README.md). Normal setup does not require a proxy, Playwright, or model credits.

`ALLOW_TEST_MAGIC_LINKS` is disabled by production Actions. Never enable it for a public Installation. `CI_VERIFICATION_CONCURRENCY` defaults to two. See [sandbox execution limits](sandbox-agent.md), [Cursor verification](cursor-provider.md), and [Codex verification](../tools/codex-smoke/README.md) for runtime details.

## Workspace recovery and execution

Workspace restarts use the provisioning Workflow and retain restart requests across retries. Restart validates the selected provider credentials before evicting the runtime.

A failed Check starts a repair Turn only when the User enables automatic repair. Each Workspace permits three consecutive repair Turns; a passing Check or new User message resets the limit. Production operations never start repair Turns. Delivery survives runtime restarts without starting another Turn for an already delivered result.

Dependency repairs use native shell commands. Correct dependency failures with `bun install`, then run `workspace_run_checks` to create and verify a normal Checkpoint. Agent and Check commands share limits of ten minutes and eight MiB of captured output per command. Check verification does not receive deployment credentials.

CI tests the pinned template with its recorded Bun version. Import rejects a different commit. Update the pin only after the replacement passes its contract checks.

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

## Managed state and source resource changes

The external starter can opt into managed KV and Queue journals and registered SQLite Durable Objects. Review the [managed state contract](../packages/cloudflare-recovery/MANAGED-STATE.md) and [object recovery requirements](../packages/cloudflare-recovery/README.md). Object capture requires a completed restore drill. Unsupported storage or an uncertain mutation keeps writes paused.

Use [source resource removal](resource-removal.md) to prepare an exact reviewed Workspace. Detaching a Queue consumer does not retire the Queue while its Worker binding remains. A Durable Object namespace referenced by a saved recovery point cannot be deleted through the normal recoverable release path.

The [partial cleanup experiment](../tools/release-smoke/cleanup-lock.md) locks a selected disposable Preview object temporarily to test a real deletion failure and retry.
