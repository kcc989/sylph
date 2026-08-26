CREATE TABLE user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX user_email_unique ON user (email);

CREATE TABLE session (
  id TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL,
  token TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  active_organization_id TEXT
);

CREATE UNIQUE INDEX session_token_unique ON session (token);
CREATE INDEX session_user_id_idx ON session (user_id);

CREATE TABLE account (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  issuer TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope TEXT,
  password TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX account_user_id_idx ON account (user_id);
CREATE UNIQUE INDEX account_issuer_account_id_unique ON account (issuer, account_id);

CREATE TABLE verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX verification_identifier_idx ON verification (identifier);

CREATE TABLE organization (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  logo TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER
);

CREATE UNIQUE INDEX organization_slug_unique ON organization (slug);

CREATE TABLE member (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX member_organization_user_unique ON member (organization_id, user_id);
CREATE INDEX member_user_id_idx ON member (user_id);

CREATE TABLE invitation (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at INTEGER NOT NULL,
  inviter_id TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX invitation_organization_id_idx ON invitation (organization_id);
CREATE INDEX invitation_email_idx ON invitation (email);

CREATE TABLE project (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES user (id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  artifact_repo_id TEXT NOT NULL,
  artifact_repo TEXT NOT NULL,
  artifact_remote TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX project_organization_slug_unique ON project (organization_id, slug);

CREATE TABLE workspace (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL REFERENCES user (id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'provisioning',
  repository_mode TEXT NOT NULL DEFAULT 'base',
  base_artifact_repo TEXT NOT NULL,
  workspace_artifact_repo TEXT NOT NULL,
  error_summary TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX workspace_organization_id_idx ON workspace (organization_id);
CREATE INDEX workspace_project_id_idx ON workspace (project_id);
