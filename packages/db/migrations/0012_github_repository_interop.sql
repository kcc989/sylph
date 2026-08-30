ALTER TABLE project ADD COLUMN upstream_head TEXT;
ALTER TABLE project ADD COLUMN upstream_status TEXT NOT NULL DEFAULT 'disconnected';
ALTER TABLE project ADD COLUMN upstream_synced_at INTEGER;
ALTER TABLE project ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'pull_request';
ALTER TABLE project ADD COLUMN delivered_commit TEXT;
ALTER TABLE project ADD COLUMN delivery_url TEXT;
