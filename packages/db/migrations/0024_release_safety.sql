ALTER TABLE deployment ADD COLUMN base_deployment_id TEXT;
ALTER TABLE deployment ADD COLUMN recovery_deployment_id TEXT;
ALTER TABLE deployment ADD COLUMN review_json TEXT;
ALTER TABLE deployment ADD COLUMN recovery_json TEXT;
ALTER TABLE deployment ADD COLUMN verification_json TEXT;
ALTER TABLE deployment ADD COLUMN restore_json TEXT;
ALTER TABLE deployment ADD COLUMN mutation_started INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX deployment_one_active_project_idx ON deployment (project_id) WHERE status IN ('queued', 'running');
