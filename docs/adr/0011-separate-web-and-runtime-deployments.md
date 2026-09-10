# Deploy the web app separately from the Workspace runtime

Keep the existing `Website` Worker as the owner of Durable Objects, Workflows, containers, scheduled tasks, and the public Installation address. Move TanStack Start and static assets into a service-bound `Web` Worker that owns no Durable Objects or Workflows and has no public workers.dev endpoint. The runtime forwards web requests without rewriting URLs, headers, bodies, or WebSocket upgrades.

This retains existing namespace data, Workflow identities, container applications, credentials, and OAuth callback addresses. Moving all ownership to a new runtime Worker would require separate transfer and pending-operation migration work. The cost of retaining ownership is one service-binding hop on web requests. The initial split still updates the runtime; later UI-only changes must leave its artifact and bindings unchanged.

The runtime has a separate prebuilt artifact, consumed unchanged by Alchemy. Its build inputs exclude UI routes and components; a compiled import-graph check prevents web dependencies from entering it. Startup CPU and compressed-module budgets apply to both Workers. Wrangler is used only as a local profiler with temporary configuration; Alchemy remains the infrastructure owner.

OpenCode starts on the first Workspace operation or socket hello, after native socket admission. Socket rejection, ping, and close do not start it. OpenCode must still initialize its schema before product tables. This change does not establish idle duration-billing savings: an open event subscription or runtime background work can still prevent hibernation.
