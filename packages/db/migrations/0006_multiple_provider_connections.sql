ALTER TABLE open_code_connection RENAME TO open_code_connection_single;

CREATE TABLE open_code_connection (
  organization_id TEXT NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
  configured_by_user_id TEXT NOT NULL REFERENCES user (id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  auth_method TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  encrypted_credential TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (organization_id, provider_id)
);

CREATE INDEX open_code_connection_organization_id_idx
  ON open_code_connection (organization_id);

INSERT INTO open_code_connection (
  organization_id,
  configured_by_user_id,
  provider_id,
  model_id,
  auth_method,
  is_default,
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
  auth_method,
  1,
  encrypted_credential,
  encryption_iv,
  created_at,
  updated_at
FROM open_code_connection_single;

DROP TABLE open_code_connection_single;
