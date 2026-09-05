CREATE TABLE project_auth_secret (
  project_id TEXT PRIMARY KEY NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  encrypted TEXT NOT NULL,
  iv TEXT NOT NULL
);
