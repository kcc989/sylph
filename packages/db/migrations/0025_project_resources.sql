CREATE TABLE project_resource (
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('worker', 'd1', 'kv', 'r2', 'queue', 'domain')),
  name TEXT NOT NULL,
  resource_id TEXT,
  generation TEXT,
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'active', 'deleted')),
  PRIMARY KEY (account_id, kind, name),
  UNIQUE (account_id, kind, resource_id)
);
CREATE INDEX project_resource_project_idx ON project_resource(project_id, scope);
CREATE TABLE project_resource_operation (
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
  scope TEXT NOT NULL,
  run_id TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('deploying', 'retained', 'cleanup_failed', 'deleted', 'complete')),
  error TEXT,
  inspected_at INTEGER,
  PRIMARY KEY (account_id, project_id, scope)
);
CREATE TABLE project_secret (
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  environment TEXT NOT NULL CHECK (environment IN ('preview', 'production')),
  name TEXT NOT NULL,
  encrypted TEXT NOT NULL,
  iv TEXT NOT NULL,
  PRIMARY KEY (project_id, environment, name)
);
CREATE TABLE project_domain (
  project_id TEXT PRIMARY KEY NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL UNIQUE,
  zone_id TEXT NOT NULL
);
