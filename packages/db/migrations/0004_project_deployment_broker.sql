CREATE TABLE project_deployment_capability (
 id TEXT PRIMARY KEY,
 token_hash TEXT NOT NULL UNIQUE,
 project_id TEXT NOT NULL,
 account_id TEXT NOT NULL,
 scope TEXT NOT NULL,
 run_id TEXT NOT NULL,
 plan_json TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE project_deployment_resource (
 project_id TEXT NOT NULL,
 account_id TEXT NOT NULL,
 scope TEXT NOT NULL,
 kind TEXT NOT NULL,
 name TEXT NOT NULL,
 resource_id TEXT NOT NULL,
 PRIMARY KEY (account_id, project_id, scope, kind, name)
);
CREATE TABLE project_deployment_state (
 project_id TEXT NOT NULL,
 scope TEXT NOT NULL,
 state_key TEXT NOT NULL,
 json TEXT NOT NULL,
 PRIMARY KEY (project_id, scope, state_key)
);
