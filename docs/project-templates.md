# Project sources and templates

A Project has one Project Repository. [Project creation](../apps/web/src/functions/projects.ts) supports three source types through [ProjectSource](../packages/domain/src/project.ts):

| Source            | Behavior                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| Template          | Fork an imported, pinned Template Repository. **Start fresh** selects the built-in Cloudflare template.  |
| GitHub, connected | Import the selected repository and retain it as an Upstream Repository for synchronization and Delivery. |
| GitHub, copy      | Import source without an ongoing upstream connection.                                                    |
| Empty             | Create a minimal repository. Add required scripts before running Checks or deployments.                  |

The built-in catalog is defined in [project-templates.ts](../apps/web/src/server/project-templates.ts). It contains one default Cloudflare template. An Admin-managed template catalog, custom Installation default, and “use this Project as a template” are not implemented.

## Import and ownership

Sylph imports a template ref once per Organization and reuses that Artifacts Template Repository. The built-in import verifies its head against the expected commit. Each new Project forks the imported history and records the template key, repository, and commit. Creating its initial Workspace then forks the Project Repository.

The Project records its template origin without an upstream connection. Pin changes affect new Projects only; existing source and Accepted commits remain unchanged. See [ADR 0010](adr/0010-project-templates-are-forked-template-repositories.md).

## Operation contract

Templates are stored in an external Git repository and declare commands in `package.json`, with agent instructions in `AGENTS.md`. Sylph does not require a separate execution manifest.

| Requested operation             | Required scripts                                                |
| ------------------------------- | --------------------------------------------------------------- |
| Check                           | `typecheck`, `lint`, `test`, `build`                            |
| Preview                         | `build`, `sylph:plan`, `sylph:preview`                          |
| Basic production deployment     | `build`, `sylph:plan`, `sylph:deploy`                           |
| Managed release or data restore | The complete [managed release hook contract](release-safety.md) |

CI installs dependencies using the repository's package manager. Checkpoints, synchronization, and Acceptance do not require a Check or Preview by default. Browser requirements apply only when configured by a User.

Deployment receives the Project slug as `SYLPH_PROJECT`, the exact commit as `SYLPH_CHECKPOINT`, and `SYLPH_DEPLOYMENT` as `preview` or `production`. Deployment scripts return `SYLPH_PREVIEW_URL=` or `SYLPH_PRODUCTION_URL=`. When browser evidence is selected, the page must also show the matching `data-sylph-checkpoint` and `data-sylph-deployment` attributes.

`sylph:plan` declares resources before deployment credentials are supplied. Project deployment commands use scoped capabilities through the Installation broker. Follow [resource management](../tools/resource-management/README.md) for naming, ownership, and cleanup. Project commands do not receive the Installation’s account token.

## Release pin

[template-release.ts](../packages/domain/src/template-release.ts) records the repository, ref, immutable commit, version, and Bun version. The CI template job checks out that exact commit and validates the template and platform contract.

Use [the external template release procedure](../tools/template-contract/README.md) to prepare and verify a candidate before publication and a pin change. Candidate metadata describes the reviewed commit; it does not select the active release or confirm publication. Before a live test, verify the remote commit and deployed source and template IDs.
