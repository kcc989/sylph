# Project resource management

Organization Admins use Project settings to inspect resources, review adoption, retire production resources while retaining data, permanently remove retired resources, or retry failed Preview cleanup. Every production action requires a stored review and the exact typed confirmation `adopt production`, `retire production`, or `remove production`. Members can read inventory; they cannot start these actions.

## Supported plan

`sylph:plan` prints one `SYLPH_RESOURCE_PLAN=` JSON array before CI provides deployment credentials. The plan supports at most 20 resources, with one or more Workers. Multiple Workers require exactly one `entrypoint: true`. The returned URL must identify that Worker or the configured custom domain.

```json
[
  {
    "kind": "worker",
    "name": "<prefix>-web",
    "entrypoint": true,
    "bindings": [
      { "type": "service", "name": "API", "target": "<prefix>-runtime" },
      { "type": "durable_object_namespace", "name": "ROOMS", "target": "<prefix>-runtime/Room" },
      { "type": "workflow", "name": "JOBS", "target": "<prefix>-job" },
      { "type": "ai", "name": "AI" }
    ]
  },
  { "kind": "worker", "name": "<prefix>-runtime" },
  { "kind": "durable_object", "name": "<prefix>-runtime/Room", "worker": "<prefix>-runtime", "className": "Room" },
  { "kind": "workflow", "name": "<prefix>-job", "worker": "<prefix>-runtime", "className": "Job" },
  { "kind": "d1", "name": "<prefix>-db" },
  { "kind": "d1", "name": "<prefix>-recovery", "purpose": "recovery_control" }
]
```

The shared schemas are in `@workspace/domain/project-resources`. A service binding can specify `entrypoint` for a named Worker entrypoint. Service targets must be Workers owned by the same Project and scope. Workers AI is an explicitly reviewed account capability; it has no separately owned resource or deletion operation. Unknown kinds, binding types and excess plan properties fail validation. Bindings to another Project, dispatch namespaces, named environments, non-default R2 jurisdictions, Containers and tail consumers are outside supported management and fail with a reason. KV, R2, Queue, D1 and production custom domains remain supported. Queue consumers must be detached through the owning Alchemy stack before Worker removal if Cloudflare refuses deletion; this code does not force-detach them.

Names normally use the supplied `SYLPH_RESOURCE_PREFIX`, lowercase letters, digits and hyphens, with at most 63 characters. Durable Object names are the host Worker name plus `/` plus class name. Cloudflare namespace IDs, Workflow IDs, and creation timestamps are captured independently; a class name or Workflow name alone is insufficient identity. Domains use the configured hostname and can specify the target `worker`.

A name prefix is a coordination convention, not credential isolation or proof of ownership. Undeclared resources are not automatically claimed or deleted. The operation stops and identifies the resource that needs review. Account API read failures are errors, including collection 404 responses.

## Adoption and retirement

Adoption reviews an entire previously untracked production topology. Paste its resource plan into Project settings. The server reads provider identities and bindings, rejects any existing ownership claim, and stores a review with a 15-minute confirmation window. Confirmation checks the same inventory again and acquires the production operation lock. The Workflow checks identities again before claiming anything. Adoption cannot steal resources or automatically create missing ones. Legacy physical names require `adopted: true` in the subsequent deployment plan and an active matching claim.

Sylph adoption records ownership. The Project's `alchemy.run.ts` must also adopt the existing resources with per-resource Alchemy adoption policy, preserve logical IDs, and retain physical resources. This code does not rewrite Project source or an existing Alchemy state file. Review that source before the next production deploy; a blanket account-wide adoption flag is not a substitute for the reviewed plan.

Retirement requires detaching bindings from Workers that will remain active. It retains the selected resources and data, keeps their claims, and prevents future deployment use. Remove retired resources from the next plan and retain them in Alchemy state. Permanent removal requires a second review and confirmation. A failed removal retains per-resource progress and reports its error; review only the remaining retired resources to retry.

Deletion checks all account Worker bindings and host-owned DO/Workflow/domain dependencies before mutation, and checks them again during removal. Domains and Workflows are removed before Workers, then backing data resources. Durable Objects are removed only with their host Worker, after every associated namespace has an exact owned claim and no external Worker reference is present. Only this checked path enables the provider's cascading Worker deletion. There is no fictitious Durable Object namespace DELETE endpoint. Standalone class retirement/deletion, transfers, and renames require a separately reviewed Alchemy migration and are rejected here. Authenticated collection reads must prove absence; lost DELETE responses do not imply failure if absence is independently verified.

Cloudflare does not make the account inspection plus mutation sequence atomic. External account administrators can race these checks; Project locks only serialize Sylph operations. R2 contents are drained before bucket deletion. Workers can still have provider-managed attachments outside the supported graph; provider refusal keeps cleanup failed, with claims intact.

## Recovery control and integration

`purpose: "recovery_control"` identifies a separate D1 control database. The `SYLPH_RECOVERY_CONTROL` binding must reference that claim. Application adoption, retirement and removal cannot select it. Preview cleanup retains control databases and reports a completed operation with the retained control claim visible. A mislabeled live control binding blocks cleanup before any deletion.

The template worker must add this purpose to its `<prefix>-recovery` plan entry. Recovery must exclude that database from application restore/export replacement and preserve its writer gate, manifests and secret versions. Existing control resources need independently established claims; generic application adoption deliberately cannot claim them. Full-topology production recovery needs separate adapters for DO/Workflow/KV/R2/Queue state; this change does not claim their recovery support.

Deploy database migration `0002_resource_lifecycle.sql` through Alchemy. It preserves existing claims and adds lifecycle review storage. Reconcile migration ordering when integrating sibling changes. `alchemy.run.ts` now provisions `ResourceToken` or uses a configured `RESOURCE_TOKEN`, scoped to Worker scripts, D1, KV, R2 and Queue permissions plus read-only Container attachment inspection in the installation account. Resource inspection and maintenance use it. CI deployment retains its separate account-scoped token and existing CI/Container/AI permissions. Neither token is isolated by Project name.

The template and recovery workers own the template patch, release hooks, D1 recovery adapter, secret capture and application restore. Merge their changes without replacing them with the old `template.patch` in this worktree. The resource worker changes only two resource-credential call sites plus the binding type in `workspace-ci.ts`; preserve sibling CI changes during integration.

## Reviewable verification commands

Local regression tests:

```sh
bun test apps/web/src/server/project-resources.test.ts packages/db/src/initial-schema.test.ts
bun run lint
bun run format:check
bun run typecheck
bun run test
bun run build
```

Read-only provider inspection, with `CLOUDFLARE_ACCOUNT_ID` and `RESOURCE_TOKEN` supplied by an approved protected environment:

```sh
bun tools/resource-management/inspect.ts /private/tmp/reviewed-resource-plan.json
```

The inspector prints resource identities and verifies declared Worker bindings. It does not prove Project ownership, adopt resources, delete resources, or read application records/secrets. Do not pass tokens in command arguments or copy them into this checkout.

After separate approval, follow `tests/release-smoke/README.md` to provision a new disposable stage. The concrete commands are:

```sh
bun run smoke:release:doctor -- --auth magic
bun run smoke:release:deploy -- --auth magic
```

Keep the run record and use its printed URL/optional regression command. For the combined proof, exercise a two-Worker topology with real DO/Workflow/service/AI bindings; reject a foreign service target; adopt an existing disposable topology; detach then retire it; confirm removal; induce a partial deletion failure and retry remaining claims. Include control-state retention and compare every provider ID and generation. Destructive actions require a separate current review in the UI and explicit human confirmation. No live action was executed by this worker.

## Provider references

Capabilities were checked against installed Alchemy `2.0.0-beta.76`, Distilled provider source, and official documentation: [Alchemy Worker bindings](https://alchemy.run/cloudflare/compute/workers/), [cross-Worker Durable Objects](https://alchemy.run/cloudflare/compute/cross-worker-durable-object/), [Durable Object namespace identities](https://developers.cloudflare.com/api/resources/durable_objects/), [Durable Object class lifecycle](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/), [Workflow identities](https://developers.cloudflare.com/api/resources/workflows/), [Workflow deletion](https://developers.cloudflare.com/api/resources/workflows/methods/delete/), and [Worker cascading deletion](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/delete/).

## Candidate publication dependency

The complete prepared starter is local commit `05b2a1d46af88084bae080518d0624760680fc33` on `codex/complete-release-contract` in `kcc989/sylph-tanstack-template`. The full patch reproduces it from the recorded base. Publishing this branch requires explicit approval. After publication, verify the remote immutable commit and change `packages/domain/src/template-release.ts` to the candidate ref, commit, and version `0.2.0`. Until then the shipped pin remains unchanged and the strengthened template CI correctly rejects it as incompatible.

Production capture also requires an approved real-provider restore drill for the application schema. The starter includes `scripts/sylph-recovery-drill.ts` and its precise setup in `RECOVERY.md`. The control database must exist first and is never restored with application data. First prepare checks for restore evidence before acquiring the writer pause. No publication, production deployment, restore, or resource destruction was performed while preparing this patch.

