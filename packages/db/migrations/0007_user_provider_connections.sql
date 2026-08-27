CREATE TABLE user_open_code_connection (
  user_id TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  auth_method TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  encrypted_credential TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, provider_id)
);

CREATE INDEX user_open_code_connection_user_id_idx
  ON user_open_code_connection (user_id);
