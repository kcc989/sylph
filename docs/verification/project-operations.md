# Project operations: production health to repair

Implemented on `codex/e2e-operations`, based on `301860e7b33af5dfb68b14e04148bb2681709b7b`.

Project settings now has a Production health section. A Project member can collect recent invocation observations, inspect retained diagnostic fields, acknowledge incidents, and create a repair Workspace. The existing minute schedule also collects health for up to three eligible Projects concurrently, selecting the oldest observations first. Scheduled collection waits at least five minutes between observations and shares the per-Project lease with manual collection. Larger installations can have longer collection intervals. Alerts remain inside Sylph; there is no external notification delivery.

## Data and API contracts

The release workflow captures Cloudflare deployment and version IDs for up to four owned production Workers, after resource inspection. Capture failure does not interrupt release verification; such releases show unknown health. Older releases without captured identity cannot be retroactively attributed by the collector.

The collector reads the first active deployment from the official [Workers Deployments API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/) and requires one version with 100% traffic. It queries the official [Workers Observability telemetry API](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/), using top-level `view: "events"`, `dry: true`, and Worker-name, version-ID and invocation-event filters. Deployment identity is checked before and after collection. Returned events are checked again for Worker, version, event type and window. Missing, malformed, incomplete or changed identity is unknown, not a healthy result.

Limits: one collection per Project per minute, a four-minute database lease, a 15-minute window ending one minute ago, four Workers, 100 events per Worker, 15 seconds per API request, and two MB per response. Invocation IDs deduplicate each Worker sample. Incidents deduplicate by Project, Deployment and kind. Repeated overlapping windows do not reopen acknowledged incidents. Incidents retain the latest 20 diagnostic samples; the page lists the 30 most recent incidents. The health snapshot replaces its previous sample.

HTTP 5xx and failed Worker outcomes produce error incidents. A sampled p95 wall time of at least 2,000 ms produces a latency incident. These are bounded, sampled observations, not total request counts, population percentiles, availability probes or an uptime guarantee. Missing data for any Worker keeps the overall result unknown unless a failure was observed.

Only allowlisted request IDs, Worker names, version IDs, timestamps, outcomes, status codes and wall times are retained. Request bodies, headers, URLs and application log messages are excluded. All four server functions use the existing `projectMember` middleware; incident lookups and mutations also constrain Project ID. Access is rechecked through the existing Organization membership model.

The repair action uses one D1 batch to create an Issue, a Workspace, an incident link and a queued diagnostic prompt. Creation keys make concurrent clicks and retries reuse the same records. The Workspace uses the incident's deployed commit; its local branch is checked out at that commit even if Project main has advanced. The brief includes the Deployment, exact commit, observation window, sample counts, latency and bounded evidence. Evidence is marked as untrusted data. The repair uses existing provider selection, provisioning and message delivery. It does not deploy or accept changes.

## Validation

- 111 focused tests passed across 19 files: new collector and incident cases, actual Git checkout, Workspace provisioning regressions, deployment records, domain, database and deployment tooling.
- A separate local Miniflare/Workerd D1 integration test passed: collection, cooldown, durable incidents, repair records, non-member denial, missing user identity denial and revoked-membership denial. The installed Workerd supports dates through 2026-08-06; this D1-only fixture uses 2026-08-01.
- Web, domain and database TypeScript checks passed. The full Vite production build passed (client and server). The client bundle contains none of the health API path, runtime-token binding reference or incident SQL.
- Oxlint passed for all changed TypeScript sources. Oxfmt and `git diff --check` passed.
- A local Playwright fixture rendered the actual operations component at 1280×900 and 390×844 with synthetic server responses. Collection, acknowledgement, repair navigation, invocation evidence, empty and failure states passed, with no horizontal overflow or browser errors. Screenshots were inspected: [desktop](project-operations-desktop.png), [mobile](project-operations-mobile.png).
- The in-app browser had no available browsers. The local fixture used a fresh headless browser without saved state or credentials. No delegated skill review was run because this task prohibited sub-agents.

The shared dependency tree was used read-only through local links. The already-declared `@cloudflare/puppeteer@1.1.0` was downloaded into this worktree to complete type checking. No dependency manifest or lockfile change was needed.

## Integration and live proof still required

1. Integrate `0002_project_operations.sql`; reconcile its number with other workers' migrations. Keep both new deployment/workspace columns and the health/incident tables. Common-file seams are Project settings, the CI release workflow, Workspace initialization/provisioning/Git, domain conversation schema, DB schema, environment types and runtime-token policy.
2. Apply the migration and runtime-token policy through the existing Alchemy deployment. The telemetry query API requires **Workers Observability Write**, even for temporary queries. Alchemy-created runtime tokens now request it. An explicitly supplied `CF_TOKEN` must already have it, plus Workers Scripts read capability. No token was read or used by this task.
3. Enable Workers Logs with invocation logging in the application template's Alchemy Worker settings. The template worker owns that change. Old releases without deployment identity remain unknown until a new verified release captures identity.
4. The combined lifecycle owner must use a disposable stage and the authorized release-smoke flow, then release a disposable application through its verified delivery path. Generate successful, failing and slow requests; collect the real API data; assert Cloudflare deployment/version IDs, commit, incidents and private membership boundaries. Repeat collection and repair clicks, then advance Project main and verify that the repair Workspace contains the deployed files and receives the diagnostic prompt.
5. Test disabled logs, no traffic, missing permissions, a changed Cloudflare deployment and split traffic against the real API. Verify that these remain unknown and do not invent health evidence. Live event filters and the provider-backed repair conversation were not exercised in this task.

No production deployment, PR publication or merge, resource deletion or restoration, owner credential use, or external messaging occurred. Authenticated deployed UI and live Cloudflare telemetry proof belong to the other assigned workers; local tests and synthetic screenshots do not establish those results.
