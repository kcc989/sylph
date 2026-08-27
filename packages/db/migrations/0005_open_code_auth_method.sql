ALTER TABLE open_code_connection RENAME TO open_code_connection_api_key;

CREATE TABLE open_code_connection (
  organization_id TEXT PRIMARY KEY NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
  configured_by_user_id TEXT NOT NULL REFERENCES user (id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  auth_method TEXT NOT NULL,
  encrypted_credential TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO open_code_connection (
  organization_id,
  configured_by_user_id,
  provider_id,
  model_id,
  auth_method,
  encrypted_credential,
  encryption_iv,
  created_at,
  updated_at
)
SELECT
  organization_id,
  configured_by_user_id,
  provider_id,
  model_id,
  'api-key',
  encrypted_api_key,
  encryption_iv,
  created_at,
  updated_at
FROM open_code_connection_api_key;

DROP TABLE open_code_connection_api_key;
