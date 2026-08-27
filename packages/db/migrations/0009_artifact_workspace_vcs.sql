ALTER TABLE workspace ADD COLUMN base_commit TEXT;
ALTER TABLE workspace ADD COLUMN fork_head TEXT;
ALTER TABLE workspace ADD COLUMN accepted_commit TEXT;
ALTER TABLE workspace ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE workspace ADD COLUMN merge_status TEXT NOT NULL DEFAULT 'unreviewed';
ALTER TABLE workspace ADD COLUMN latest_checkpoint_at INTEGER;
ALTER TABLE workspace ADD COLUMN archived_at INTEGER;

CREATE TABLE repository_operation (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  commit TEXT,
  error_summary TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX repository_operation_workspace_kind_id_unique ON repository_operation (workspace_id, kind, id);
CREATE INDEX repository_operation_workspace_id_idx ON repository_operation (workspace_id);
