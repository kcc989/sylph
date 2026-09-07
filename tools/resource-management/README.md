# Project resource management

The Project settings page lists the resource inventory for each production deployment and Preview attempt. Organization Admins can inspect resources, retry failed Preview cleanup, manage encrypted application secrets, and configure a production custom domain. Members can read the inventory and configuration names, but never secret values.

## Rollout

1. Apply `template.patch` to `kcc989/sylph-tanstack-template` at `bed6b52785eab6e79680041ee1367f2831f59296`. It adds `sylph:plan`, uses the reserved names in Alchemy, consumes application secrets as secret bindings, and configures the production domain. The patch was checked with the template's frozen dependencies, typecheck, lint, tests, and build.
2. Publish the reviewed template revision and update `packages/domain/src/template-release.ts` to that immutable revision. The current pin is deliberately unchanged until publication. Repositories created from an older template need the same script and Alchemy changes; Sylph does not rewrite reviewed Checkpoints.
3. Deploy the Website Worker through `alchemy.run.ts` using fresh resources. The initial database schema includes the resource inventory, and Website hosts the `ResourceMaintenance` Workflow and its binding. This baseline does not migrate previous D1 or Durable Object state. Do not run production deployment or resource destruction without approval.
4. Before rollout to existing Projects, review their resource inventory. Existing successful production deployments without claims are blocked; no automatic adoption or database replacement occurs. Legacy Previews without a recorded reservation are not eligible for automatic cleanup. A separate reviewed adoption is required for those resources.
5. Run the disposable deployed checks in `tests/release-smoke/README.md`. Include two simultaneous Preview attempts, one partial deployment failure, a browser-check failure, a cleanup retry, and a production ownership conflict. Confirm actual Worker/D1 IDs and disappearance through authenticated Cloudflare APIs. Local tests are not deployed proof.

## Deployment contract

`SYLPH_RESOURCE_PREFIX` is derived from the immutable Project ID and deployment scope. Production has a stable Project scope. Each Preview Check attempt gets its own scope, including repeated attempts at the same commit.

After build and before credentials are provided, `sylph:plan` prints exactly one line:

```text
SYLPH_RESOURCE_PLAN=[{"kind":"worker","name":"<prefix>-web"},{"kind":"d1","name":"<prefix>-db"}]
```

The prefix is supplied by CI. All names must use that prefix followed by `-`, contain only lowercase letters, digits, and hyphens, and have at most 63 characters. A plan contains one Worker and at most 20 resources. Supported resource kinds are Worker, D1, KV, R2 in the default jurisdiction, Queue, and a configured production custom domain. Custom domains use the configured hostname instead of the prefix. Previews cannot attach custom domains.

Sylph inspects the namespace before deployment, rejects unknown existing resources, and reserves names in an atomic D1 batch. A production operation excludes other production operations for that Project and account. Existing resource IDs and creation timestamps must still match. Missing owned resources and plan removals block deployment. Cloudflare read failures are errors, including HTTP 404 from a collection endpoint.

The deploy runner receives the reserved JSON in `SYLPH_RESOURCE_PLAN`, plus its prefix. Deployment scripts must use the exact plan, keep Alchemy state isolated under that prefix, and never create or adopt resources outside it. Cloudflare credentials remain account-scoped; this contract is not a security sandbox for arbitrary deployment code. Infrastructure outside the reserved namespace cannot safely be attributed to a Project or automatically deleted.

After deployment, Sylph records resource IDs and verifies Worker bindings. Any extra supported resources discovered inside the reserved namespace are recorded and cause verification to fail; Preview cleanup includes them. Worker assets and inline values belong to the Worker. Unsupported bindings fail verification instead of implying complete management.

## Cleanup and inspection

Cleanup is scheduled for any Preview whose resources were reserved, even if the deployment or browser check fails and no Preview URL is published. It runs after retention, deletes the Worker before backing resources, and verifies absence with authenticated collection reads. R2 objects are removed in batches before the bucket is deleted. Resource IDs, creation timestamps, and ownership are rechecked. Deletion progress and claims remain in D1 as tombstones. Uncertain deletions remain retryable and visible as `cleanup_failed`.

Automatic cleanup retries five times. Admins can confirm a retry from Project settings after the original CI Workflow stops. Production resources are excluded from Preview cleanup. Successful cleanup clears the Preview URL, including when a separate maintenance Workflow performs the retry. Inspection records its time and error on the operation. It does not execute SQL or expose application data.

## Application configuration

Application secrets are encrypted with the existing credential encryption key and partitioned by Project and `preview` or `production`. CI sends only the selected environment's values in `SYLPH_PROJECT_SECRETS`, a JSON object. The template validates names and turns values into Alchemy secret bindings. Verification and planning commands do not receive these secrets. Configuration APIs return names only. Scripts must not print secret values.

The production domain and zone are supplied as `SYLPH_CUSTOM_DOMAIN` and `SYLPH_CUSTOM_DOMAIN_ZONE`. The domain must appear in the plan and route to its reserved Worker after deployment. Alchemy owns domain configuration; saving a setting does not publish DNS changes. A deployed domain cannot be removed or renamed through configuration until its resource has been explicitly retired.

API shapes were checked against the installed Distilled/Alchemy source and the Cloudflare references for [resource listing](https://developers.cloudflare.com/api/resources/workers/), [D1](https://developers.cloudflare.com/api/resources/d1/), [R2 buckets](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/list/), and [Queues](https://developers.cloudflare.com/api/resources/queues/methods/list/).
