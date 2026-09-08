CREATE TABLE project_preview_cleanup_request (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  run_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  confirmed_scope TEXT NOT NULL,
  previous_status TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'preparing',
  terminal_status TEXT,
  confirmed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX project_preview_cleanup_active ON project_preview_cleanup_request(project_id, account_id, scope) WHERE status IN ('preparing', 'dispatched');
