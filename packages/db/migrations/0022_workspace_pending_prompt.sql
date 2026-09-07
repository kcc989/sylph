CREATE TABLE workspace_pending_prompt (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  error_summary TEXT,
  delivered_at INTEGER
);
CREATE INDEX workspace_pending_prompt_workspace_idx ON workspace_pending_prompt(workspace_id, delivered_at, sequence);
ALTER TABLE workspace ADD COLUMN provisioning_scheduled_at INTEGER;
ALTER TABLE workspace_pending_prompt ADD COLUMN scheduled_at INTEGER;
CREATE INDEX workspace_provisioning_schedule_idx ON workspace(status, provisioning_scheduled_at, created_at);
CREATE INDEX workspace_pending_prompt_schedule_idx ON workspace_pending_prompt(delivered_at, scheduled_at, sequence);
