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

`purpose: "recovery_control"` identifies independently retained control or isolated drill resources. The `SYLPH_RECOVERY_CONTROL` binding must reference that claim. Application adoption, retirement and removal cannot select it. Preview cleanup retains control databases and reports a completed operation with the retained control claim visible. A mislabeled live control binding blocks cleanup before any deletion.

The prepared starter labels its `<prefix>-recovery` plan entry with this purpose. Recovery must exclude that database from application restore/export replacement and preserve its writer gate, manifests and secret versions. Existing control resources need independently established claims; generic application adoption deliberately cannot claim them. Coordinated recovery supports guarded D1 and R2 state. DO/Workflow/KV/Queue state needs separate tested adapters.

Deploy database migration `0003_resource_lifecycle.sql` through Alchemy. It preserves existing claims and adds lifecycle review storage. It follows `0002_project_operations.sql`. `alchemy.run.ts` now provisions `ResourceToken` or uses a configured `RESOURCE_TOKEN`, scoped to Worker scripts, D1, KV, R2 and Queue permissions plus read-only Container attachment inspection in the installation account. Resource inspection and maintenance use it. Installation services retain account credentials. Project deployment commands receive only a short-lived capability tied to the exact active resource plan; broker requests verify the claim and operation on every call.

The complete template patch includes the deployment broker state helper, coordinated D1/R2 release hooks, isolated drills, encrypted snapshots and application restore/undo. Its publication status and source hashes are recorded in `template-candidate.json`.

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

## Starter publication and candidate

The current built-in pin remains the previously approved starter `0.2.0`, commit `36860839fb2b1536228775998f3cce730f5b028c`. The new `0.3.0` candidate is `6450aa6b0bcd19873d09c2471ad9a359ed307a4f` on the local `codex/project-capability-broker` branch and is not published.

`template.patch` reproduces the candidate from the recorded legacy base; `template-upgrade.patch` reproduces it from the previous published release. Candidate metadata records the exact source and patch hashes. Both patches and the combined control schema were independently verified. See [candidate procedure](../template-contract/README.md). Publication and the built-in pin update require the separate approval before this change can ship. Existing Projects need the reviewed source upgrade; a new pin does not modify accepted Checkpoints.

First prepare verifies that every initial Worker is absent before bootstrap can apply migrations. It then performs isolated provider drills for the supported schema and optional R2 topology before recording the application recovery group. Control and scratch resources remain retained independently. Local SQLite-backed hook tests pass; no production deployment, live application restore, or resource destruction was performed by this integration.
