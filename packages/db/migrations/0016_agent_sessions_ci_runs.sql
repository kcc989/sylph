ALTER TABLE workspace ADD COLUMN fork_deleted_at INTEGER;

CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  opencode_session_id TEXT NOT NULL,
  parent_session_id TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  model_override TEXT,
  reasoning_override TEXT,
  latest_attention_at INTEGER,
  last_read_at INTEGER,
  archived_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX agent_sessions_workspace_id_idx ON agent_sessions (workspace_id);
CREATE UNIQUE INDEX agent_sessions_opencode_session_unique ON agent_sessions (workspace_id, opencode_session_id);

CREATE TABLE ci_runs (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  agent_session_id TEXT,
  workflow_instance_id TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  summary_json TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX ci_runs_project_created_idx ON ci_runs (project_id, created_at);
CREATE INDEX ci_runs_workspace_id_idx ON ci_runs (workspace_id);
CREATE INDEX ci_runs_commit_sha_idx ON ci_runs (commit_sha);
