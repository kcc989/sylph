ALTER TABLE project ADD COLUMN template_key TEXT;
ALTER TABLE project ADD COLUMN template_repo TEXT;
ALTER TABLE project ADD COLUMN template_commit TEXT;

CREATE TABLE template_repository (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  artifact_repo TEXT NOT NULL,
  artifact_remote TEXT NOT NULL,
  head_commit TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX template_repository_source_unique ON template_repository (organization_id, source_url, source_ref);
CREATE INDEX template_repository_organization_id_idx ON template_repository (organization_id);
