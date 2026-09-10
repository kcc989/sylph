# Sylph documentation

The [root README](../README.md#the-architecture) describes the current architecture. [CONTEXT.md](../CONTEXT.md) defines product terms. This directory contains operating guides and architecture decisions; test commands are documented beside their tools.

## Operating an Installation

| Guide | Use it for |
| --- | --- |
| [Deploy your own Sylph](operators.md) | Fresh Installation setup, credentials, domains, updates, and teardown |
| [Maintaining Sylph](maintainers.md) | Releases, local development, and shared smoke infrastructure |
| [Project templates](project-templates.md) | Project sources, the built-in pin, and external template releases |
| [Production releases and application data](release-safety.md) | Basic deployment, optional managed recovery, and Admin-confirmed restore |
| [Project resource management](../tools/resource-management/README.md) | Resource plans, ownership, adoption, retention, and cleanup |
| [Prepare resource removal](resource-removal.md) | Source changes needed before Queue or Durable Object retirement |
| [Production health and repair](project-operations.md) | Sampled telemetry, incidents, and repair Workspaces |
| [Preserve an earlier Installation](installation-transition.md) | Legacy D1 preservation and parallel operation; not an in-place schema upgrade |

## Workspace runtime

| Guide | Use it for |
| --- | --- |
| [Sandbox agent execution](sandbox-agent.md) | Durable files, container commands, synchronization, and limits |
| [Cursor provider](cursor-provider.md) | Provider container isolation and repeatable verification |
| [Browser journeys and acceptance](browser-testing.md) | Shared Browser Run, human control, and optional required journeys |
| [Workspace and CI performance](performance/workspace-and-ci.md) | Provisioning, caching, concurrency, and measurement limits |

## Architecture decisions

- [0001: One Organization per Installation](adr/0001-single-organization-installation.md)
- [0002: Layered model selection](adr/0002-layered-model-selection.md)
- [0003: Cloudflare CI as code](adr/0003-cloudflare-ci-as-code.md)
- [0004: Server-function middleware and Durable Object RPC](adr/0004-server-function-middleware-and-durable-object-rpc.md)
- [0005: Domain schemas at interfaces](adr/0005-domain-schemas-are-the-interface.md)
- [0006: Project Repository operations and background provisioning](adr/0006-project-repository-operations-in-the-worker.md)
- [0007: Hibernatable Workspace WebSocket](adr/0007-hibernatable-workspace-websocket.md)
- [0008: Optional Workspace-owned Check repair](adr/0008-workspace-owned-check-loop.md)
- [0009: Presentational shared UI](adr/0009-keep-shared-shell-ui-presentational.md)
- [0010: Forked Template Repositories](adr/0010-project-templates-are-forked-template-repositories.md)
- [0011: Separate web and runtime deployments](adr/0011-separate-web-and-runtime-deployments.md)

The template ADR was renumbered from the duplicate `0005` to `0010`.

## Verification

- [Release smoke](../tests/release-smoke/README.md): fresh deployment, explicit auth mode, manual inspection, and optional browser regression.
- [Combined lifecycle proof](../tests/release-smoke/COMBINED.md): application lifecycle tests for a recorded source revision.
- [Browser service smoke](../tools/browser-smoke/README.md): shared browser ownership, navigation, and evidence.
- [Direct Cursor probe](../tools/cursor-smoke/README.md) and [Codex probe](../tools/codex-smoke/README.md): provider-specific isolation checks.
- [Template contract](../tools/template-contract/README.md): release pin and standalone template verification.

[Historical evidence](archive/README.md) retains dated smoke results, screenshots, and handoffs. These records describe earlier source revisions and fixtures, including retired integrations. Verify source and deployment IDs before continuing a run. Use current runbooks and obtain any required approval for new actions.
