# Run Project Repository Git operations in the Worker

Project Repository creation, GitHub import, and upstream synchronization run on an in-memory filesystem in `apps/web/src/server/project-repository-git.ts`. Running them in a Workspace Durable Object would also boot OpenCode and store a clone that Workspace initialization would discard. Synchronization compares remote heads and clones only when they differ. Operations that need the durable Working copy or agent session remain in the Durable Object.

Project creation creates the Project Repository and initial Workspace fork before scheduling provisioning. Creating another Workspace saves its record and schedules provisioning; the Workflow then synchronizes the Project Repository and creates its fork. Both paths start the Workspace as `provisioning`. The Workflow loads files, activates credentials, and creates the session. The screen reads `provisioning`, `ready`, or `error` from the runtime snapshot.

Restart validates the requested model and saves an idempotent request before starting a new provisioning execution. The Workflow reuses the fork, evicts the runtime, and initializes it again. A recovery job can retry dispatch. Request identity and provisioning status prevent older executions from overwriting newer state.

An archived Workspace keeps its archived marker during restart and returns to archived status on success or failure. Concurrent restarts and restarts during provisioning or Acceptance are rejected.
