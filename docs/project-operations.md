# Production health and repair

In Project settings, members can collect invocation observations, inspect diagnostics, acknowledge incidents, and create repair Workspaces. Each minute, Sylph collects up to three Projects with the oldest observations. It waits at least five minutes per Project and shares the collection lease with manual requests. Larger Installations may wait longer. Notifications stay in Sylph.

## Data and API contracts

Collection uses the latest published release, including one that failed after publication. A newer failure before publication does not replace it. A failed publication also creates a release incident even if telemetry is unavailable or provider IDs changed. That incident reports the operation’s failure, not current traffic health. Unknown identity never causes collection from an older release.

After inspecting resources, the release Workflow records deployment and version IDs for up to four owned production Workers. Failure to record them leaves health unknown without interrupting verification. The collector cannot assign observations to older releases without those IDs.

The collector reads the first active deployment from the official [Workers Deployments API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/) and requires one version with 100% traffic. It queries the official [Workers Observability telemetry API](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/), using top-level `view: "events"`, `dry: true`, and Worker-name, version-ID and invocation-event filters. The collector checks deployment identity before and after collection, then verifies each event’s Worker, version, type, and time window. Missing, invalid, incomplete, or changed identity leaves health unknown.

Limits: one collection per Project per minute, a four-minute database lease, a 15-minute window ending one minute ago, four Workers, 100 events per Worker, 15 seconds per API request, and two MB per response. Invocation IDs identify duplicate events. Project, Deployment, and kind identify duplicate incidents. Repeated overlapping windows do not reopen acknowledged incidents. Incidents retain the latest 20 diagnostic samples; the page lists the 30 most recent incidents. The health snapshot replaces its previous sample.

HTTP 5xx and failed Worker outcomes produce error incidents. A sampled p95 wall time of at least 2,000 ms produces a latency incident. These limited samples do not measure all traffic, overall percentiles, availability, or uptime. Missing data for any Worker keeps the overall result unknown unless a failure was observed.

Only allowlisted request IDs, Worker names, version IDs, timestamps, outcomes, status codes and wall times are retained. Request bodies, headers, URLs and application log messages are excluded. All four server functions use `projectMember` middleware. Incident reads and changes also check Project ID and Organization membership.

One D1 batch creates the repair Issue, Workspace, incident link, and queued diagnostic prompt. Creation keys prevent duplicate records on concurrent clicks or retries. The Workspace starts at the incident’s deployed commit even if Project main has advanced. Its prompt includes the Deployment, commit, observation window, sample counts, latency, and limited evidence marked as untrusted data. Repair uses normal provider selection, provisioning, and message delivery. It does not accept or deploy changes.

## Configuration and validation

Application Workers must enable invocation logs. Alchemy-managed runtime tokens include Workers Observability Write; a supplied `CF_TOKEN` also needs that permission and Worker access. Releases without recorded provider identity show unknown health until a new deployment records it.

Collection and repair are implemented in [project-operations.ts](../apps/web/src/server/project-operations.ts), [cloudflare-health.ts](../apps/web/src/server/cloudflare-health.ts), and [the Project operations server functions](../apps/web/src/functions/project-operations.ts).

Use the [combined lifecycle runbook](../tests/release-smoke/COMBINED.md) for deployed verification. Check real successful, failing, and slow requests, identity drift, missing logs, missing permissions, duplicate incident actions, and a repair Workspace created after the Project Repository has advanced. Local fixtures and [archived results](archive/verification/project-operations.md) do not verify live telemetry or model behavior.
