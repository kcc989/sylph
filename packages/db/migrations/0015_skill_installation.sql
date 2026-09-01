CREATE TABLE skill_installation (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES project(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('installation', 'project')),
  target_id TEXT NOT NULL,
  catalog_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_hash TEXT,
  name TEXT NOT NULL,
  description TEXT,
  disable_model_invocation INTEGER NOT NULL DEFAULT 0,
  user_invokable INTEGER NOT NULL DEFAULT 1,
  files TEXT NOT NULL,
  installed_by_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (
    (scope = 'installation' AND project_id IS NULL) OR
    (scope = 'project' AND project_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX skill_installation_scope_name_unique
  ON skill_installation (scope, target_id, name);
CREATE INDEX skill_installation_organization_id_idx
  ON skill_installation (organization_id);
CREATE INDEX skill_installation_project_id_idx
  ON skill_installation (project_id);
