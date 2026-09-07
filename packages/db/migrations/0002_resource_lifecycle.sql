CREATE TABLE project_resource_v2 (
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('worker', 'd1', 'kv', 'r2', 'queue', 'domain', 'durable_object', 'workflow')),
  name TEXT NOT NULL,
  resource_id TEXT,
  generation TEXT,
  purpose TEXT NOT NULL DEFAULT 'application' CHECK (purpose IN ('application', 'recovery_control')),
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'active', 'retired', 'deleted')),
  PRIMARY KEY (account_id, kind, name),
  UNIQUE (account_id, kind, resource_id)
);
CREATE TABLE project_resource_operation_v2 (
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
  scope TEXT NOT NULL,
  run_id TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('deploying', 'retained', 'cleanup_failed', 'deleted', 'complete', 'maintaining')),
  error TEXT,
  inspected_at INTEGER,
  PRIMARY KEY (account_id, project_id, scope)
);
INSERT INTO project_resource_v2 (account_id, project_id, scope, kind, name, resource_id, generation, state)
SELECT account_id, project_id, scope, kind, name, resource_id, generation, state FROM project_resource;
INSERT INTO project_resource_operation_v2 SELECT * FROM project_resource_operation;
DROP TABLE project_resource;
DROP TABLE project_resource_operation;
ALTER TABLE project_resource_v2 RENAME TO project_resource;
ALTER TABLE project_resource_operation_v2 RENAME TO project_resource_operation;
CREATE INDEX project_resource_project_idx ON project_resource(project_id, scope);
CREATE TABLE project_resource_review (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
  review_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reviewed', 'confirmed', 'running', 'complete', 'failed')),
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
