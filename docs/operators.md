# Operating a Sylph Installation

This guide is for the person who deploys and runs one Sylph Installation in their own Cloudflare account. It covers what you need before you start, what the setup wizard creates, how to upgrade, how to tear the Installation down, and what to check when something fails.

## The deployment model

Sylph is deployed from a fork of the repository, not from a package.

1. Fork `kcc989/sylph` on GitHub and clone your fork.
2. Run `./scripts/setup.sh` from the clone.
3. Push to your fork's `main` branch to deploy updates through the `Deploy production` GitHub Actions workflow.
4. Upgrade by syncing your fork with upstream and pushing.

Your fork holds no secrets in git. Secrets live in `.env` on the machine that ran setup and in your fork's GitHub Actions secrets. Alchemy stores deployment state in your Cloudflare account, so any machine with the deploy token and the repository can deploy.

## Prerequisites

Tools on the machine that runs setup:

| Tool                                                 | Why                                                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Bun (the version in `package.json` `packageManager`) | Runs the wizard helpers, installs dependencies, and runs Alchemy                       |
| Docker, running                                      | Alchemy pulls the Cloudflare sandbox image and re-pushes it to your account's registry |
| OpenSSL, curl, git                                   | Secret generation, Cloudflare API calls, and the fork itself                           |
| GitHub CLI (`gh`), authenticated against your fork   | Optional. Publishes production secrets and variables automatically                     |

Cloudflare account state:

- Workers Paid plan. Durable Objects with SQLite storage, Workflows, Containers, Browser Rendering, and Workers AI are used.
- A registered `workers.dev` subdomain. The wizard checks for one and opens the dashboard if it is missing.
- R2 enabled on the account.
- Access to Cloudflare Artifacts. The wizard cannot probe this. If the first deployment fails while creating the Artifacts namespace, request access for your account before retrying.

GitHub:

- An account, or an organization you administer, that can create and install a GitHub App.

## Credentials the wizard creates

| Value                                                    | Where it lives                                            | Purpose                                                                                                                                                        |
| -------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy token (`CLOUDFLARE_API_TOKEN`)                    | `.env`, GitHub Actions secret                             | Alchemy deploys with it. It also mints the two credentials below, which is why it needs Account API Tokens Write. It is never placed in a Worker.              |
| Runtime token (`CF_TOKEN`)                               | `.env`, GitHub Actions secret, Worker secret              | Cloudflare CI passes it into the sandbox so generated projects can deploy previews, and the runtime deletes expired previews with it. It cannot create tokens. |
| R2 key pair (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) | `.env`, GitHub Actions secrets, Worker secrets            | Cloudflare CI snapshots dependency installs to the check backup bucket.                                                                                        |
| `BETTER_AUTH_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`        | `.env`, GitHub Actions secrets, Worker secrets            | Session signing and encryption of provider credentials stored in D1.                                                                                           |
| `INSTALLATION_CLAIM_SECRET`                              | `.env`, GitHub Actions secret, Worker secret              | Entered once at `/setup` to create the Organization.                                                                                                           |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`               | `.env`, GitHub Actions variable and secret, Worker config | Sign-in and repository access through your GitHub App.                                                                                                         |

If you would rather not grant Account API Tokens Write, create the runtime token and the R2 key pair yourself in the dashboard, put them in `.env` before running the wizard, and the wizard reuses them instead of minting new ones.

## What the first deployment creates

All resources are created in your account under the Alchemy stage `prod`.

| Resource                  | Notes                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `Website` Worker          | The TanStack Start app. Runs an hourly cron that refreshes the provider model catalog.                  |
| `WorkspaceRuntime` Worker | Hosts the `WorkspaceDO` Durable Object namespace, the `CI` Workflow, and the sandbox container binding. |
| D1 database               | Drizzle migrations in `packages/db/migrations` run on every deploy.                                     |
| Artifacts namespace       | One fork per workspace.                                                                                 |
| Two R2 buckets            | Check backups and check evidence.                                                                       |
| Container application     | `cloudflare/sandbox`, instance type `standard-4`, up to ten instances.                                  |
| Browser Rendering binding | Used by workspace browser checks.                                                                       |
| Three Workflows           | `CI`, `WorkspaceMerge`, and `WorkspaceRetention`.                                                       |

## Cost drivers

The Workers Paid plan is the floor. Beyond it, spend scales with:

- Container minutes. Each check run starts a `standard-4` sandbox. Idle Installations cost nothing here.
- Durable Object storage and requests. One object per workspace, plus SQLite storage for its state.
- R2 storage. Check backups are pruned by the retention Workflow, but evidence accumulates until workspaces are archived.
- Browser Rendering minutes when browser checks run.
- Workers AI usage if you connect the Cloudflare provider.

Model provider spend is separate and goes to whichever provider you connect from `/admin`.

## Running setup

```sh
./scripts/setup.sh
```

The wizard is idempotent. Stop it at any stage and re-run it; values already in `.env` are offered as defaults. The stages are:

1. Preflight: local tools, Docker, and whether the clone points at your fork.
2. Cloudflare deploy token: paste the account ID and one custom token. The wizard verifies it and configures Alchemy to use it.
3. Account readiness: probes for a `workers.dev` subdomain and R2.
4. Runtime credentials: mints the runtime token and R2 key pair.
5. Installation secrets: generates the random secrets.
6. Initial deployment: deploys and captures the URL. This stage pulls and pushes the sandbox image, which can take several minutes with no visible progress on a fresh account.
7. GitHub App: creates the App from a manifest with the callback URL and permissions pre-filled, then you install it on the repositories Sylph may access.
8. Production automation: publishes secrets and variables to your fork with `gh`.
9. Launch and claim: redeploys with GitHub sign-in enabled and opens `/setup`.

At `/setup`, sign in with the account that should become the first Admin, confirm the verified email address, enter an Organization name, and paste `INSTALLATION_CLAIM_SECRET` from `.env`. Only this one-time claim can create the Organization. After it, use `/admin` to connect a model provider and invite other Users.

## Deploying updates

Push to your fork's `main` branch. The `Deploy production` workflow runs format, lint, typecheck, tests, and build, then deploys with Alchemy. The workflow reads the same secrets the wizard published. It targets a GitHub environment named `production`; GitHub creates it on first use, and you can add required reviewers to it if you want a manual gate.

To deploy from your machine instead:

```sh
bun alchemy deploy --stage prod
```

Alchemy reads `.env` from the repository root and authenticates with the deploy token because the wizard set the default profile to the environment method.

## Upgrading

```sh
git fetch upstream
git merge upstream/main
git push origin main
```

Read `CHANGELOG.md` for the versions you are crossing. Entries call out when an upgrade needs a new secret, a token permission, or a re-run of the wizard. D1 migrations apply automatically during the deploy.

## Teardown

```sh
bun alchemy destroy --stage prod
```

This deletes every resource listed above, including the D1 database, the R2 buckets, and every workspace fork in the Artifacts namespace. There is no undo. Revoke the deploy token, the runtime token, and the R2 token in the Cloudflare dashboard afterwards, and delete the GitHub App.

## Troubleshooting

**Deploy fails with "Forbidden" on some resources but not others.** Alchemy is using a different credential than you think. Open `~/.alchemy/profiles.json` and check that the `default` profile's `Cloudflare` entry has `"method": "env"`. A browser-login (OAuth) profile has narrower scopes than the deploy token and silently wins over `.env`. Reset it from the repository root with `CI=true bunx alchemy login --configure`.

**The deploy sits on "Pushing container image" with no progress.** This is the sandbox image being re-pushed to your account's registry. It takes several minutes on a fresh stage. Do not interrupt it. Later deploys reuse the pushed layers.

**"Access denied" or HTTP 403 from R2 during a check or preview.** The R2 key pair is invalid or revoked. Test it before reading Sylph code:

```sh
curl -s -o /dev/null -w '%{http_code}\n' -X PUT --data-binary @/dev/null \
  "https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com/<bucket>/probe" \
  --aws-sigv4 "aws:amz:auto:s3" --user "$R2_ACCESS_KEY_ID:$R2_SECRET_ACCESS_KEY"
```

Delete `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` from `.env` and re-run the wizard to mint a new pair.

**The first deploy fails while creating the Artifacts namespace.** Your account does not have Cloudflare Artifacts enabled. Request access, then re-run the deploy. Alchemy resumes from the resources it already created.

**`bun install` fails on macOS with a workerd signature error.** The `postinstall` script re-signs the workerd binary. Run `bash scripts/prepare-workerd.sh` and retry.

**GitHub sign-in redirects to an error.** The App's callback URL must be exactly `<your URL>/api/auth/callback/github`. Check it on the App's settings page, and check that `GITHUB_CLIENT_ID` in your fork's variables matches the App you installed.

**Deploy production fails on "Missing production secret or variable".** The wizard's production automation stage was skipped or `gh` was not authenticated. Re-run the wizard and accept the publish prompt, or set the named secret with `gh secret set NAME`.

**A deploy was interrupted and the next one reports an undefined Durable Object namespace.** Re-run the same deploy. Alchemy recovers the half-created resources on the second pass.
