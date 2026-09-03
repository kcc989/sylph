CREATE TABLE issue (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by_user_id TEXT NOT NULL REFERENCES user (id) ON DELETE RESTRICT,
  closed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX issue_project_number_unique ON issue (project_id, number);
CREATE INDEX issue_organization_id_idx ON issue (organization_id);
CREATE INDEX issue_project_id_idx ON issue (project_id);
