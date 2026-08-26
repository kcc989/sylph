ALTER TABLE open_code_connection RENAME TO open_code_connection_user;

CREATE TABLE open_code_connection (
  organization_id TEXT PRIMARY KEY NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
  configured_by_user_id TEXT NOT NULL REFERENCES user (id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  encrypted_api_key TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

DROP TABLE open_code_connection_user;
