ALTER TABLE deployment ADD COLUMN identity_json TEXT;
ALTER TABLE workspace ADD COLUMN repair_commit TEXT;
CREATE TABLE project_health (
 project_id TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
 observation_json TEXT,
 collected_at INTEGER NOT NULL DEFAULT 0,
 lease_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE project_incident (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
 deployment_id TEXT NOT NULL REFERENCES deployment(id) ON DELETE CASCADE,
 "commit" TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('errors', 'latency', 'release')),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'acknowledged')),
 first_seen INTEGER NOT NULL,
 last_seen INTEGER NOT NULL,
 observation_json TEXT NOT NULL,
 workspace_id TEXT REFERENCES workspace(id) ON DELETE SET NULL,
 issue_id TEXT REFERENCES issue(id) ON DELETE SET NULL,
 UNIQUE(project_id, deployment_id, kind)
);
CREATE INDEX project_incident_recent ON project_incident(project_id, last_seen DESC);
