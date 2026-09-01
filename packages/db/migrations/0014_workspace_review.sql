CREATE TABLE workspace_review (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  "commit" TEXT NOT NULL,
  decision TEXT NOT NULL DEFAULT 'pending',
  reviewer_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  submitted_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX workspace_review_revision_unique ON workspace_review (workspace_id, "commit");
CREATE INDEX workspace_review_workspace_id_idx ON workspace_review (workspace_id);

CREATE TABLE workspace_review_comment (
  id TEXT PRIMARY KEY NOT NULL,
  review_id TEXT NOT NULL REFERENCES workspace_review(id) ON DELETE CASCADE,
  file TEXT NOT NULL,
  side TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  body TEXT NOT NULL,
  author_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  resolved_at INTEGER,
  resolved_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX workspace_review_comment_review_id_idx ON workspace_review_comment (review_id);
