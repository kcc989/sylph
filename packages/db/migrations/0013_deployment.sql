CREATE TABLE deployment (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  "commit" TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  production_url TEXT,
  actor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  failure_details TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX deployment_project_id_idx ON deployment (project_id);
CREATE INDEX deployment_project_commit_idx ON deployment (project_id, "commit");
