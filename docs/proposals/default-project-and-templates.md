# Default Project and Project templates

Status: proposal, 2026-09-02. Not yet decided; see the open decisions at the end.

Update, same day: the first template exists as a separate repository, currently at `/Users/caseycollins/projects/sylph-tanstack-template` and not yet pushed. It is TanStack Start, shadcn/ui, Effect v4, Better Auth on D1, and Alchemy v2. Building it settled two of the open decisions below and surfaced three Sylph-side follow-ups listed under "What the template needs from Sylph".

## The problem

"Start fresh" creates a Project that cannot pass a Check. The Workspace runtime seeds a README and a `package.json` with no scripts, and the CI pipeline exits with code 64 at the first missing script (`typecheck`). The onboarding prompt then asks the agent to "make one small, useful improvement to this starter project", but there is no project to improve and no way to verify the result on Cloudflare.

Sylph's promise is a general coding agent whose work is verified and deployed on Cloudflare. The default Project is where that promise is first tested, so it must satisfy the Check contract out of the box and teach the agent how Cloudflare and Alchemy fit together. At the same time, an Installation is customer-operated, so operators need to replace or extend the default with their own starting points.

## What already exists

- Project creation clones a git remote at a ref into the Workspace Durable Object, pushes it to a fresh Artifacts repository, and forks that repository for the first Workspace. The import branch of `WorkspaceGit.prepareProject` is a template instantiator with the upstream connection left on.
- The Check contract is the interface between Sylph and a Project: `typecheck`, `lint`, `test`, `build`, `sylph:preview`, and `sylph:deploy` package scripts. The preview script prints `SYLPH_PREVIEW_URL=` and the Preview page must render `SYLPH_CHECKPOINT=<sha>` and `SYLPH_DEPLOYMENT=preview`. ADR 0003 deliberately avoids a proprietary manifest beyond this.
- Cloudflare CI injects the operator's `CF_TOKEN` as `CLOUDFLARE_API_TOKEN` and the account ID as `CLOUDFLARE_ACCOUNT_ID` into any runner with `cloudflareCredentials`. An Alchemy-based Project can deploy Previews and production today without new plumbing.
- OpenCode reads `AGENTS.md` from the project root. A template's agent guidance can live in the repository instead of a Sylph setting.
- Skills exist at Installation and Project scope. A first-party Cloudflare Skill is the natural home for guidance that should apply to every Project, not just templated ones.
- Preview cleanup deletes the Worker script named by the Preview hostname. It knows nothing about other resources a Preview stage created.

## What the ecosystem does

Two research passes (Cloudflare template systems, and ten agent products) converge on the same shape:

- A template is a git repository at a ref that you copy. Replit forks a template app, Lovable copies a codebase, Bolt uses starter URLs, Devin clones a ref, C3 accepts `owner/repo/subdir#ref`, and Artifacts offers `import` from a URL and `fork` from a repository. Nobody ships a separate template format except VibeSDK, which zips templates into R2 because its sandbox has no git.
- Setup configuration lives in a committed file, secrets live in the UI. Copilot, Cursor, Devin, Replit, Conductor, and bb all read a file from the repository. Sylph's file is `package.json`, plus `AGENTS.md` for the agent.
- The only "default" mechanism anyone ships is pinning one template. Replit pins a template to the Agent input box per team; Lovable allows one default design template per workspace.
- Opinionated products refuse import, general agents refuse blank. The few that do both treat blank as "create a repository, then behave like import". That is already the shape of Sylph's create path.
- Cloudflare's own template metadata is a `cloudflare` object in `package.json` (`label`, `products`, `categories`, `bindings`, preview images). Reusing those keys costs nothing and keeps Sylph templates readable by Cloudflare tooling.
- Alchemy v2 has no scaffolding command. Sylph owns its template model.

## Recommendation

### 1. A Project template is a git repository at a ref, imported once and forked

No manifest. Sylph reads what it already reads: package scripts for the Check contract, `AGENTS.md` for the agent, and optionally the `cloudflare` object in `package.json` for display metadata. Sylph imports the template ref once per Installation into an Artifacts Template Repository, then forks it for every new Project. Forking is instant regardless of size, never passes through the Durable Object working tree, and keeps history, so the Project's origin is a commit with a merge base rather than a URL. The template is not recorded as an Upstream Repository; provenance lives in `project.template_key`, `project.template_repo`, and `project.template_commit`, and the imported repositories in `template_repository`.

Nothing is rewritten in the fork. Sylph passes `SYLPH_PROJECT`, the Project slug, to the preview and production stages so a template can derive unique Alchemy stack and Worker names from it. Implemented 2026-09-02 as ADR 0005.

### 2. Creation offers three sources, and "Start fresh" means the default template

`CreateProjectInput.source` becomes a union:

- `template`: a built-in key or an Installation template ID. Preselected with the Installation's default.
- `github`: URL plus branch, with a mode. `connected` keeps the Upstream Repository for synchronization and Delivery, which is today's import. `copy` detaches, which makes any GitHub repository usable as a one-off template without touching the catalog.
- `empty`: today's README-only repository, moved under an "Advanced" disclosure with a warning that Checks fail until the contract scripts exist.

### 3. Templates come from two places, and the Installation pins one

- Built-in templates live in this monorepo under `templates/<name>/`, pinned to the deployed Sylph commit through a build-time `SYLPH_TEMPLATES_REF` value. The Check contract, the template, and the release smoke test then change in the same pull request. Fetching from the public GitHub repository at creation time needs no token.
- Installation templates are Admin-managed rows in a new `project_template` table: name, description, source kind (`github` or `project`), URL, ref, subdirectory, or source Project ID. A `github` template is instantiated through the copy path. A `project` template forks the Project Repository through Artifacts, which is instant and keeps history; this is how "mark this Project as a template" works from Project settings.
- `installation.default_project_template` names a built-in key or a template row. `/admin` gains a "Project templates" section to add from a GitHub URL (reusing the existing repository lookup), set the default, and remove. Templates are Installation-scoped, matching Skill Installations.

### 4. The Cloudflare tie-in is the template, a Skill, and a first task

- The default template ships `AGENTS.md` explaining Alchemy v2, the Check contract, and the Sylph tools. Verify that the OpenCode Workerd profile reads `AGENTS.md` from the virtual filesystem; if it does not, the workspace plugin's session context hook must inject it beside the existing system prompt.
- A first-party Cloudflare Skill, installed at Installation scope during the claim, carries the guidance that should apply to imported Projects too: Workers, D1, Durable Objects, KV, R2, Alchemy patterns, and the deploy contract.
- Import validation: when a `github` import lacks contract scripts, say so on the Workspace and make the onboarding prompt "Make this Project pass Sylph Checks on Cloudflare". This is where a general repository meets the Cloudflare story, and the agent does the work rather than the user.

### 5. The default template is a Cloudflare app on TanStack Start and Alchemy v2

One template first. TanStack Start matches Sylph's own stack and the conventions the maintainers already enforce, and it is where Lovable moved for new apps in 2026. Contents:

- `alchemy.run.ts` with `Cloudflare.Website.Vite`, `Cloudflare.providers()`, and `Cloudflare.state()`.
- `package.json` with `dev`, `typecheck`, `lint`, `test`, `build`, `sylph:preview`, `sylph:deploy`, a committed `bun.lock`, and a `cloudflare` metadata object.
- `scripts/sylph-deploy.ts`: chooses the stage from `SYLPH_DEPLOYMENT` and `SYLPH_CHECKPOINT` (`preview-<sha7>` or `production`), runs `alchemy deploy --yes`, and prints `SYLPH_PREVIEW_URL=` or `SYLPH_PRODUCTION_URL=`. Alchemy prints stack outputs after deploy but documents no `--json` flag, so the wrapper parses the output or computes the URL from a deterministic Worker name.
- A route that renders `SYLPH_CHECKPOINT=<sha>` and `SYLPH_DEPLOYMENT=<kind>` when the deployment is a Preview, from values Alchemy passes as `env`.
- `AGENTS.md`, one Bun test, an oxlint configuration, and no committed `.env` (Alchemy reads `.env` before the process environment).

Keep the first template stateless. Preview cleanup deletes only the Worker script, so a D1 database or bucket created per Preview stage would leak, and Alchemy's remote state entries for each Preview stage already leak in a small way. Generalize cleanup before shipping a stateful template: at retention expiry, run `alchemy destroy --stage <preview>` in a CI sandbox instead of a raw script delete. Later templates: a Hono API Worker with D1, and an Agents SDK Worker with a Durable Object.

### What the template needs from Sylph

Building the template against the Check contract exposed three gaps on the Sylph side.

- Project secrets. Better Auth needs `BETTER_AUTH_SECRET`, and the CI sandbox only receives the Cloudflare token, account ID, and the two `SYLPH_*` variables. The template generates a throwaway secret for Previews and refuses a production deploy without one. Cloudflare CI already supports a `secrets` runner option that injects named Worker secrets, so Sylph should add per-Project secrets and pass them to the `sylph:preview` and `sylph:deploy` stages.
- Stage destruction. Every Preview stage creates its own D1 database. The template exposes `sylph:preview:destroy`, which runs `alchemy destroy` for the same stage name. Preview cleanup should run that script in a sandbox at retention expiry when it exists, and fall back to deleting the Worker script when it does not.
- Alchemy state in the sandbox. The template uses `Cloudflare.state()` so production deploys update resources instead of recreating them. That means the operator's `CF_TOKEN` must be allowed to create the state store; the setup wizard's token scopes already cover it, but the requirement should be documented with the Check contract.

### 6. Repositories outside GitHub push to Sylph

Do not build an upload path. Create an empty Project, show the Artifacts remote and a short-lived write token minted by the existing `RepositoryStore.access`, and let the user `git push`. The first Workspace syncs on creation. This covers self-hosted git and local-only work with no new storage or size limits.

## Schema and API changes

- `project_template`: `id`, `organization_id`, `name`, `description`, `source_kind`, `source_url`, `source_ref`, `source_path`, `source_project_id`, `created_by_user_id`, `created_at`, `updated_at`, `archived_at`.
- `installation.default_project_template`: text, nullable; a built-in key or a `project_template.id`.
- `project.template_origin`: text, nullable; `url#ref@sha` or `project:<id>@<sha>`.
- `CreateProjectInput.source` union as above; `PrepareProjectRepositoryInput` gains `detach`, `path`, and `packageName`.
- Server functions: `listProjectTemplates`, `addProjectTemplate`, `setDefaultProjectTemplate`, `removeProjectTemplate`, `markProjectAsTemplate`, `createProjectPushCredentials`.

## Sequencing

1. Done: default template and the fork path. The `source` union on project creation, the one-time Artifacts import into a Template Repository, the fork in the create path, the provenance columns, the built-in default template, and `SYLPH_PROJECT` in the deploy stages. The template is published at https://github.com/kcc989/sylph-tanstack-template and pinned to `v0.1.0`. Still open from this step: extend the release smoke test to run a Check and expect a Preview URL.
2. Import modes and validation. Add the `copy` mode, the contract check on import, and the "make this pass Checks" onboarding prompt.
3. Installation catalog. Add `project_template`, the `/admin` section, the default pointer, and "use this Project as a template".
4. Push to Sylph for repositories outside GitHub.
5. Cloudflare Skill auto-installed at claim, and `alchemy destroy` based Preview cleanup, which unlocks stateful templates.

## Open decisions

1. Decided: built-in templates live in separate repositories. The default template is its own repository, referenced by URL and ref from Sylph. Pin the ref in Sylph's configuration so a template change cannot break an existing Installation without a Sylph release.
2. Decided: TanStack Start is the first template, with Hono as a likely second.
3. Revised: the first template is stateful because Better Auth needs D1. Ship it, and prioritize the `sylph:preview:destroy` cleanup path above.

## Sources

- Cloudflare templates repository and `package.json` `cloudflare` metadata: https://github.com/cloudflare/templates
- C3 remote template addressing: https://developers.cloudflare.com/pages/get-started/c3/
- Artifacts Workers binding, `import` and `fork`: https://developers.cloudflare.com/artifacts/api/workers-binding/
- Cloudflare CI runner options and credential injection: https://github.com/cloudflare/ci/blob/main/src/pipeline/types.ts and https://github.com/cloudflare/ci/blob/main/src/ci/capabilities.ts
- VibeSDK templates: https://github.com/cloudflare/vibesdk-templates
- Alchemy stages and CI previews: https://alchemy.run/environments/stages and https://alchemy.run/environments/ci
- OpenCode rules and config: https://opencode.ai/docs/rules/ and https://opencode.ai/docs/config/
- Replit custom templates: https://docs.replit.com/teams/custom-templates
- Lovable design templates: https://docs.lovable.dev/features/business/design-templates
- Devin blueprints: https://docs.devin.ai/onboard-devin/environment/blueprint-reference
- Cursor Cloud Agent setup: https://cursor.com/docs/cloud-agent/setup
- Conductor settings: https://www.conductor.build/docs/reference/settings
- bb schema: https://github.com/get-bb/bb/blob/main/packages/db/src/schema.ts
