# Sylph as a software factory

Status: proposal, 2026-09-09. Not yet decided; see the open decisions at the end.

## The problem

Sylph already has the stations of a software factory: Issues, Workspaces, Checkpoints, Checks, Previews, Evidence, reviews, Acceptance, Delivery, Deployments, and incidents. What it lacks is the conveyor between them. Each hand-off is a hard-wired code path, and only the Check-to-agent hand-off in ADR 0008 closes a loop without a User.

Three consequences follow:

- A User's review comments block Acceptance, but the agent does not see them until the User writes a new prompt.
- A production incident is recorded with `workspace_id` and `issue_id` columns, but nothing creates the Issue or wakes an agent.
- Nothing outside the browser can learn that a Check passed, a Preview is ready, or a Deployment failed. An external agent, a chat integration, or an Operator's own tooling has no way in.

OpenCode solves the in-process version of this with plugin hooks. GitHub solves the cross-system version with webhooks. Sylph needs both, on one event catalog, without violating two rules it already holds: a Durable Object request never waits on external work, and D1 never stores a second transcript.

## What already exists

- **In-process hooks.** `apps/web/src/server/workspace-plugin.ts` registers OpenCode session hooks for context, model requests, and HTTP responses, plus tool, skill, agent, catalog, and VCS transforms. Only first-party code can add them.
- **One closed loop.** ADR 0008: a failed Check delivers a durable inbox message that resumes the agent, bounded by two continuations per Check and three consecutive continuations per Workspace. Delivery is idempotent, retried by the Durable Object alarm, and suppressed for archived Workspaces and stale Checkpoints. This is the prototype of every agent trigger below.
- **Two product events on the wire.** `workspace.check.updated` and `workspace.event.truncated`. Every other socket frame is a raw OpenCode session event, filtered by `packages/domain/src/workspace-event-policy.ts`.
- **Planned but unbuilt outbox.** The README names `app_outbox` and `app_processed_callbacks` in the Durable Object schema. D1 already has `repository_operation` and `magic_link_outbox` as smaller outboxes.
- **Fixed verification gates.** `workspaceAcceptance` in `packages/domain/src/acceptance.ts` computes blockers from a fixed list: passing Check, browser journey proof, approved review, no unresolved comments, clean Working copy, current base.
- **One-way GitHub.** Delivery pushes or opens a pull request. Synchronization compares heads on demand. No inbound webhooks, and ADR 0004 defers a public route until a non-browser surface exists.
- **Skills with scope.** Skill Installations exist at Installation and Project scope with a settled override rule, and the plugin already injects them into the runtime.

## Proposed language

These terms are proposed, not adopted. Move them into `CONTEXT.md` when the decisions below are made.

**Factory event**:
A durable, typed record that one station of the factory emits when something changed, such as a Check completing or a review comment arriving. A Factory event is a small, redacted summary with ids, never content.

**Subscription**:
A durable, asynchronous registration that delivers matching Factory events to a target. A Subscription cannot change or refuse the event that caused it.

**Delivery attempt**:
One recorded attempt to deliver a Factory event to a Subscription target.

**Interceptor**:
A synchronous hook on the request path that can refuse or change one factory action before or after it runs. Interceptors run inside the Worker or Durable Object and are bounded in time.

**Gate**:
An Interceptor on Acceptance or Deployment that contributes one blocker and its Evidence. A Gate is the unit of pluggable verification.

**Automatic Turn**:
A Turn started by a Subscription instead of a User message. Check continuation becomes one kind of Automatic Turn, and the existing continuation budget bounds every kind.
_Avoid_: Trigger, automation

The `CONTEXT.md` definition of **Check continuation** stays valid. It names one Automatic Turn, not a separate mechanism.

## Recommendation

### 1. One event catalog in `@workspace/domain`

Per ADR 0005, each Factory event is defined once as a schema. Use GitHub-style dotted names, and a shared envelope:

| Field | Purpose |
|---|---|
| `id` | Stable event id; also the idempotency key for every consumer |
| `type` | One of the catalog names below |
| `occurredAt` | Time the state change was recorded |
| `projectId`, `workspaceId` | Origin; `workspaceId` is null for Project-scoped events |
| `actor` | `user`, `agent`, or `system`, with the id where one exists |
| `cause` | The id of the Factory event that led to this one, or null |
| `depth` | Length of the `cause` chain; enforced maximum |
| `data` | The event-specific summary schema |

Initial catalog:

```text
issue.opened            issue.closed
workspace.created       workspace.archived      workspace.discarded
turn.started            turn.ended
agent.question.asked    agent.question.answered
permission.asked        permission.replied
checkpoint.created
check.started           check.completed
preview.ready           preview.expired
evidence.captured
review.commented        review.decided          review.requested
acceptance.requested    acceptance.completed
delivery.completed
deployment.started      deployment.succeeded    deployment.failed
incident.opened         incident.resolved
upstream.pushed         upstream.pr.reviewed    upstream.issue.opened
```

Payloads follow the Check diagnostics rule: bounded, redacted, and safe for D1. A consumer that needs file content, a transcript, or a diff reads it through an authenticated route with its own credentials. This keeps the "no second transcript" rule intact.

### 2. Two hook kinds, kept separate

This is the main design decision. An Interceptor and a Subscription look similar to an author but have opposite requirements, and one mechanism cannot satisfy both.

**Interceptors** run on the request path, inside the Durable Object or Worker. They can refuse or change the action. They follow the OpenCode `before` and `after` shape that the plugin already uses:

| Hook point | Can refuse | Can change | Where it runs |
|---|---|---|---|
| `turn.before` | yes | system context, model | Durable Object |
| `tool.before`, `tool.after` | yes | input, output | Durable Object |
| `checkpoint.before` | yes | commit message | Durable Object |
| `check.before` | yes | stage list | Worker, CI dispatch |
| `acceptance.gate` | contributes a blocker | Evidence | Worker |
| `deployment.before` | yes | nothing | Worker, deployment broker |

Model Interceptors as one Effect service, `FactoryHooks`, with a typed registration per hook point and a per-call time bound. First-party code registers them in TypeScript through Layers. Skills register them declaratively only; see section 6.

**Subscriptions** are asynchronous and at-least-once. They cannot refuse. Targets:

| Target | Effect |
|---|---|
| `webhook` | HTTPS POST with an HMAC-SHA256 signature, event type, and delivery id headers |
| `workspace` | Deliver the event as a durable inbox message to an existing Workspace, starting an Automatic Turn |
| `workspace.create` | Create a Workspace from the referenced Issue and start its first Turn |
| `workflow` | Start a named Cloudflare Workflow with the event as its payload |

The split protects the rule that a Durable Object request never waits on external work: refusals happen on the request path and are deterministic; fan-out survives eviction and never holds the object open.

### 3. The event spine is the planned outbox

Write each Factory event in the same transaction as the state change it records. Workspace-scoped events go to a new `app_factory_event` table in the Durable Object's SQLite; Project-scoped events such as deployments, incidents, and issues go to a `factory_event` table in D1. Both are outboxes, not logs: a row is retained for a bounded window after delivery, and D1 keeps an index-sized summary only.

One Cloudflare Queue, `FACTORY_EVENTS`, is the bus. The Durable Object alarm and a Worker cron drain their outboxes into the Queue, keyed by event id so redelivery is idempotent. A consumer Worker reads the Queue, matches events against `event_subscription`, and writes one `event_delivery` row per attempt with status, response summary, and next attempt time. Failed deliveries retry with backoff and land in a dead-letter Queue after a bounded number of attempts. The Admin surface lists deliveries and offers redelivery, as GitHub does.

The Workspace socket also broadcasts every Factory event as a `factory.event` frame. The existing refresh-scope policy maps them to UI refreshes, which gives the Workspace an activity feed with no extra plumbing.

Schema:

- `event_subscription`: `id`, `organization_id`, `project_id` nullable, `scope` (`installation` or `project`), `event_filter` (list of catalog names or prefixes), `target_kind`, `target_json`, `secret_encrypted` for webhooks, `created_by_user_id`, `status`, `created_at`, `updated_at`, `disabled_at`, `disabled_reason`.
- `event_delivery`: `id`, `subscription_id`, `event_id`, `attempt`, `status`, `response_summary`, `next_attempt_at`, `created_at`, `finished_at`.
- `factory_event` in D1 and `app_factory_event` in the Durable Object: the envelope columns plus `data_json` and `dispatched_at`.

### 4. Agents as subscribers

Generalize ADR 0008 instead of adding a second path. The Check continuation becomes the first built-in Subscription: `check.completed` with a failed status and a `workspace` target that names the origin Workspace. Delivery reuses the durable inbox admission, the retry alarm, and the suppression rules for archived Workspaces and stale Checkpoints. Every Automatic Turn then shares one continuation budget, and the envelope `depth` limit stops agent-to-agent loops that the per-Workspace budget alone cannot see.

Three more built-ins earn their place first:

- `review.commented` with a `workspace` target: the agent addresses review feedback without a new prompt. The User still approves.
- `incident.opened` with a `workspace.create` target: the maintenance Workflow creates an Issue from the incident, fills the `issue_id` column that already exists, and starts a Workspace on it.
- `review.requested` with a `workspace.create` target: a reviewer agent works in its own Workspace fork, reads the diff through the review route, and posts comments. Its comments arrive as `review.commented`, so agent review and human review share one channel and one Gate.

Give the agent a small surface through the plugin:

- `factory_events`: list Factory events for this Workspace or Project since a cursor.
- `factory_subscribe`: create a Project-scoped Subscription, limited to `workspace` targets that name the agent's own Workspace. Agents never create webhooks.
- `factory_emit`: emit a `custom.*` event with a bounded payload, for agent-to-agent hand-offs the catalog does not cover.

Add one session context hook that injects the Factory events since the last Turn as a short list. This is the same mechanism the system prompt uses today, and it replaces the ad hoc synthetic messages for Check results with one shape.

### 5. Verification as pluggable Gates

`workspaceAcceptance` computes blockers from a fixed list. Change it to fold in the registered `acceptance.gate` results: each Gate returns a status, a blocker string, and Evidence ids. Deployment gets the same treatment through `deployment.before`, which the deployment broker already positions as the confirmation point.

A Gate must record its decision as Evidence with the existing `WorkspaceCheckEvidence` schema, extended with a `verdict` kind. Then an LLM-judge review, a dependency audit, a performance budget, a screenshot comparison, or a second agent's approval are all one kind of thing, each auditable from the Check detail, and none of them can waive proof any more than the agent can waive a browser journey today.

The current blockers become built-in Gates. Nothing changes for a Project with no extra Gates registered.

### 6. Skills carry hooks

A Skill already bundles instructions and resources with Installation and Project scope. Extend its frontmatter with two keys:

```yaml
on:
  - event: review.requested
    target: workspace.create
gate:
  - point: acceptance.gate
    requires: review.decided
    by: this-skill
```

`on` registers Subscriptions when the Skill is installed and removes them when it is uninstalled. `gate` registers a declarative Gate: a condition on Factory events and Evidence, evaluated by first-party code. Skills never run arbitrary code inside the Durable Object; a Skill that needs computation does it in a Workspace Turn or a CI sandbox and reports through Evidence. This keeps the Durable Object Workerd-safe and keeps the Interceptor time bound honest.

A "security review" Skill is then: `on: review.requested` starts a reviewer agent with the Skill's instructions, and `gate: acceptance.gate` blocks Acceptance until that agent has recorded a `review.decided` event.

### 7. GitHub as a peer in both directions

Inbound: add `/api/github/webhook` verified with the GitHub App webhook secret. Normalize `push`, `pull_request_review`, and `issues` into `upstream.pushed`, `upstream.pr.reviewed`, and `upstream.issue.opened`. This is the non-browser surface ADR 0004 waits for, so it is the point to add the small router the ADR describes. The GitHub App needs the webhook permission it does not have today; document it beside the existing Contents, Pull requests, and Email addresses permissions.

Outbound: mirror `check.completed` to a commit status and `deployment.*` to a GitHub Deployment on the Upstream Repository when one is connected. Sylph then reads as a normal CI and deployment provider inside an existing GitHub-centric pipeline, and pull request delivery shows the Check that justified it.

An external agent, such as a coding-agent session that already understands GitHub webhooks, subscribes with an ordinary `webhook` Subscription and needs no Sylph-specific client.

## Sequencing

Each step ships alone and is useful alone.

1. **Catalog and emission.** Define the envelope and the catalog in `@workspace/domain`. Emit from the existing seams: Check apply and completion in the Durable Object, the review store, the merge Workflow, the deployment broker, and resource maintenance for incidents. Broadcast on the socket and render an activity feed. No new infrastructure.
2. **Spine and webhooks.** Outbox tables, the Queue, `event_subscription`, `event_delivery`, the consumer Worker, and the Admin delivery log. Record this as an ADR: it is hard to reverse, surprising without context, and a real trade-off against direct calls.
3. **Automatic Turns.** Fold Check continuation into the Subscription model with the shared budget and depth limit. Ship `review.commented` and `incident.opened` as built-ins. Add the agent tools and the context hook.
4. **Interceptors and Gates.** The `FactoryHooks` service, the hook points, Gate folding in `workspaceAcceptance`, the Evidence verdict kind, and the Skill `on` and `gate` keys.
5. **GitHub both ways.** Inbound webhook route, status and Deployment mirroring, and the App permission change.

## Risks

- **Loops.** Any agent-to-event-to-agent path needs the continuation budget and the envelope depth limit together. A per-Workspace budget cannot see a loop that alternates between two Workspaces; depth can.
- **Cost.** Every Automatic Turn is a paid Turn. Subscriptions need a per-Project Automatic Turn budget per day and an Admin kill switch that disables all Subscriptions in a Project at once.
- **Leakage.** Webhook payloads use the same redaction as Check diagnostics. Never include tokens, Preview credentials, or file content. Webhook targets need an HTTPS allowlist like the browser origin allowlist, and private address ranges are refused.
- **A second transcript.** Factory events are summaries with ids. Consumers read details with their own credentials. Retention on both outboxes is bounded.
- **Code in the Durable Object.** Skill-registered hooks are declarative. Arbitrary code runs in a Workspace Turn or a CI sandbox.
- **Ordering.** The Queue does not guarantee order across a Project. Consumers key on `cause` and version fields in `data`, not on arrival order.

## Open decisions

1. Whether Project-scoped events live in D1 or in a Project Durable Object. D1 is simpler today; a Project object would give ordering and a single writer. Decide with step 2.
2. Whether `factory_emit` exists in the first release. It is the smallest tool but the easiest to misuse; it may wait until a real agent-to-agent hand-off needs it.
3. Whether Gates can be Project-scoped only, or also Installation-scoped as a policy Admins apply to every Project. The Skill scope rule suggests both, with Project overriding Installation.
4. Whether inbound GitHub Issues create Sylph Issues automatically or only through a Subscription an Admin enables. The safer default is opt-in.

## Sources

- ADR 0003, Cloudflare CI as code: `docs/adr/0003-cloudflare-ci-as-code.md`
- ADR 0004, server function middleware and Durable Object RPC: `docs/adr/0004-server-function-middleware-and-durable-object-rpc.md`
- ADR 0005, domain schemas are the interface: `docs/adr/0005-domain-schemas-are-the-interface.md`
- ADR 0008, Workspace-owned Check loop: `docs/adr/0008-workspace-owned-check-loop.md`
- OpenCode plugin hooks as used in `apps/web/src/server/workspace-plugin.ts`
- Acceptance blockers: `packages/domain/src/acceptance.ts`
- Incident and health tables: `packages/db/src/schema.ts`
- GitHub webhook events and payloads: https://docs.github.com/en/webhooks/webhook-events-and-payloads
- GitHub Deployments API: https://docs.github.com/en/rest/deployments/deployments
- Cloudflare Queues: https://developers.cloudflare.com/queues/
