CREATE TABLE IF NOT EXISTS sylph_recovery_gate (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  owner TEXT,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active >= 0)
);
INSERT OR IGNORE INTO sylph_recovery_gate (id, owner, active) VALUES (1, NULL, 0);
CREATE TABLE IF NOT EXISTS sylph_recovery_manifest (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  database_id TEXT NOT NULL,
  json TEXT NOT NULL,
  sha256 TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sylph_recovery_operation (
  release_id TEXT PRIMARY KEY,
  manifest_id TEXT NOT NULL,
  schema_fingerprint TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('restoring', 'verified', 'uncertain')),
  evidence TEXT
);
CREATE TABLE IF NOT EXISTS sylph_recovery_secret_deployment (
  release_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  json TEXT NOT NULL,
  sha256 TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sylph_recovery_resource_operation (
  release_id TEXT NOT NULL,
  resource_kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  manifest_id TEXT NOT NULL,
  schema_fingerprint TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('restoring', 'verified', 'uncertain')),
  evidence TEXT,
  PRIMARY KEY (release_id, resource_kind, resource_id)
);
CREATE TABLE IF NOT EXISTS sylph_recovery_group (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  json TEXT NOT NULL,
  sha256 TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sylph_recovery_group_operation (
  release_id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('restoring', 'verified', 'uncertain'))
);
