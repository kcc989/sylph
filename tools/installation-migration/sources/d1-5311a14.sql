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

CREATE TABLE magic_link_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX magic_link_outbox_email_idx ON magic_link_outbox (email);

CREATE TABLE open_code_connection (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  encrypted_api_key TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

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

ALTER TABLE project ADD COLUMN import_origin_url TEXT;
ALTER TABLE project ADD COLUMN import_origin_branch TEXT;

ALTER TABLE workspace ADD COLUMN base_commit TEXT;
ALTER TABLE workspace ADD COLUMN fork_head TEXT;
ALTER TABLE workspace ADD COLUMN accepted_commit TEXT;
ALTER TABLE workspace ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE workspace ADD COLUMN merge_status TEXT NOT NULL DEFAULT 'unreviewed';
ALTER TABLE workspace ADD COLUMN latest_checkpoint_at INTEGER;
ALTER TABLE workspace ADD COLUMN archived_at INTEGER;

CREATE TABLE repository_operation (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  "commit" TEXT,
  error_summary TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX repository_operation_workspace_kind_id_unique ON repository_operation (workspace_id, kind, id);
CREATE INDEX repository_operation_workspace_id_idx ON repository_operation (workspace_id);

CREATE TABLE `installation` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text,
  `claimed_by_user_id` text,
  `claimed_at` integer,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`claimed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);

INSERT INTO `installation` (`id`) VALUES ('default');

UPDATE `installation`
SET
  `organization_id` = (SELECT `id` FROM `organization` ORDER BY `created_at` LIMIT 1),
  `claimed_by_user_id` = (
    SELECT `user_id`
    FROM `member`
    WHERE `organization_id` = (SELECT `id` FROM `organization` ORDER BY `created_at` LIMIT 1)
      AND `role` IN ('owner', 'admin')
    ORDER BY `created_at`
    LIMIT 1
  ),
  `claimed_at` = CASE WHEN EXISTS (SELECT 1 FROM `organization`) THEN unixepoch() ELSE NULL END
WHERE EXISTS (SELECT 1 FROM `organization`);

ALTER TABLE `open_code_connection` RENAME TO `open_code_connection_legacy`;
DROP INDEX `open_code_connection_organization_id_idx`;
CREATE TABLE `open_code_connection` (
  `organization_id` text NOT NULL,
  `configured_by_user_id` text NOT NULL,
  `provider_id` text NOT NULL,
  `auth_method` text NOT NULL,
  `encrypted_credential` text NOT NULL,
  `encryption_iv` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
  PRIMARY KEY (`organization_id`, `provider_id`),
  FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`configured_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
CREATE INDEX `open_code_connection_organization_id_idx` ON `open_code_connection` (`organization_id`);
INSERT INTO `open_code_connection` SELECT `organization_id`, `configured_by_user_id`, `provider_id`, `auth_method`, `encrypted_credential`, `encryption_iv`, `created_at`, `updated_at` FROM `open_code_connection_legacy`;

ALTER TABLE `user_open_code_connection` RENAME TO `user_open_code_connection_legacy`;
DROP INDEX `user_open_code_connection_user_id_idx`;
CREATE TABLE `user_open_code_connection` (
  `user_id` text NOT NULL,
  `provider_id` text NOT NULL,
  `auth_method` text NOT NULL,
  `encrypted_credential` text NOT NULL,
  `encryption_iv` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
  PRIMARY KEY (`user_id`, `provider_id`),
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `user_open_code_connection_user_id_idx` ON `user_open_code_connection` (`user_id`);
INSERT INTO `user_open_code_connection` SELECT `user_id`, `provider_id`, `auth_method`, `encrypted_credential`, `encryption_iv`, `created_at`, `updated_at` FROM `user_open_code_connection_legacy`;

CREATE TABLE `organization_provider_model` (
  `organization_id` text NOT NULL,
  `provider_id` text NOT NULL,
  `model_id` text NOT NULL,
  `name` text NOT NULL,
  `discovered_at` integer DEFAULT (unixepoch()) NOT NULL,
  PRIMARY KEY (`organization_id`, `provider_id`, `model_id`),
  FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `organization_provider_model_organization_id_idx` ON `organization_provider_model` (`organization_id`);
INSERT INTO `organization_provider_model` (`organization_id`, `provider_id`, `model_id`, `name`, `discovered_at`) SELECT `organization_id`, `provider_id`, `model_id`, `model_id`, `updated_at` FROM `open_code_connection_legacy`;

CREATE TABLE `user_provider_model` (
  `user_id` text NOT NULL,
  `provider_id` text NOT NULL,
  `model_id` text NOT NULL,
  `name` text NOT NULL,
  `discovered_at` integer DEFAULT (unixepoch()) NOT NULL,
  PRIMARY KEY (`user_id`, `provider_id`, `model_id`),
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `user_provider_model_user_id_idx` ON `user_provider_model` (`user_id`);
INSERT INTO `user_provider_model` (`user_id`, `provider_id`, `model_id`, `name`, `discovered_at`) SELECT `user_id`, `provider_id`, `model_id`, `model_id`, `updated_at` FROM `user_open_code_connection_legacy`;

CREATE TABLE `organization_model_preference` (
  `organization_id` text PRIMARY KEY NOT NULL,
  `provider_id` text NOT NULL,
  `model_id` text NOT NULL,
  `configured_by_user_id` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`configured_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
INSERT INTO `organization_model_preference` (`organization_id`, `provider_id`, `model_id`, `configured_by_user_id`, `created_at`, `updated_at`) SELECT `organization_id`, `provider_id`, `model_id`, `configured_by_user_id`, `created_at`, `updated_at` FROM `open_code_connection_legacy` WHERE `is_default` = 1;

CREATE TABLE `user_model_preference` (
  `user_id` text PRIMARY KEY NOT NULL,
  `provider_id` text NOT NULL,
  `model_id` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT INTO `user_model_preference` (`user_id`, `provider_id`, `model_id`, `created_at`, `updated_at`) SELECT `user_id`, `provider_id`, `model_id`, `created_at`, `updated_at` FROM `user_open_code_connection_legacy` WHERE `is_default` = 1;

DROP TABLE `open_code_connection_legacy`;
DROP TABLE `user_open_code_connection_legacy`;

ALTER TABLE project ADD COLUMN upstream_head TEXT;
ALTER TABLE project ADD COLUMN upstream_status TEXT NOT NULL DEFAULT 'disconnected';
ALTER TABLE project ADD COLUMN upstream_synced_at INTEGER;
ALTER TABLE project ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'pull_request';
ALTER TABLE project ADD COLUMN delivered_commit TEXT;
ALTER TABLE project ADD COLUMN delivery_url TEXT;

CREATE TABLE deployment (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  "commit" TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  production_url TEXT,
  actor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  failure_details TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX deployment_project_id_idx ON deployment (project_id);
CREATE INDEX deployment_project_commit_idx ON deployment (project_id, "commit");

CREATE TABLE workspace_review (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  "commit" TEXT NOT NULL,
  decision TEXT NOT NULL DEFAULT 'pending',
  reviewer_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  submitted_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX workspace_review_revision_unique ON workspace_review (workspace_id, "commit");
CREATE INDEX workspace_review_workspace_id_idx ON workspace_review (workspace_id);

CREATE TABLE workspace_review_comment (
  id TEXT PRIMARY KEY NOT NULL,
  review_id TEXT NOT NULL REFERENCES workspace_review(id) ON DELETE CASCADE,
  file TEXT NOT NULL,
  side TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  body TEXT NOT NULL,
  author_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  resolved_at INTEGER,
  resolved_by_user_id TEXT REFERENCES user(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX workspace_review_comment_review_id_idx ON workspace_review_comment (review_id);

CREATE TABLE skill_installation (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES project(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('installation', 'project')),
  target_id TEXT NOT NULL,
  catalog_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_hash TEXT,
  name TEXT NOT NULL,
  description TEXT,
  disable_model_invocation INTEGER NOT NULL DEFAULT 0,
  user_invokable INTEGER NOT NULL DEFAULT 1,
  files TEXT NOT NULL,
  installed_by_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (
    (scope = 'installation' AND project_id IS NULL) OR
    (scope = 'project' AND project_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX skill_installation_scope_name_unique
  ON skill_installation (scope, target_id, name);
CREATE INDEX skill_installation_organization_id_idx
  ON skill_installation (organization_id);
CREATE INDEX skill_installation_project_id_idx
  ON skill_installation (project_id);

ALTER TABLE workspace ADD COLUMN fork_deleted_at INTEGER;

CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  opencode_session_id TEXT NOT NULL,
  parent_session_id TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  model_override TEXT,
  reasoning_override TEXT,
  latest_attention_at INTEGER,
  last_read_at INTEGER,
  archived_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX agent_sessions_workspace_id_idx ON agent_sessions (workspace_id);
CREATE UNIQUE INDEX agent_sessions_opencode_session_unique ON agent_sessions (workspace_id, opencode_session_id);

CREATE TABLE ci_runs (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  agent_session_id TEXT,
  workflow_instance_id TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  summary_json TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX ci_runs_project_created_idx ON ci_runs (project_id, created_at);
CREATE INDEX ci_runs_workspace_id_idx ON ci_runs (workspace_id);
CREATE INDEX ci_runs_commit_sha_idx ON ci_runs (commit_sha);

ALTER TABLE project ADD COLUMN template_key TEXT;
ALTER TABLE project ADD COLUMN template_repo TEXT;
ALTER TABLE project ADD COLUMN template_commit TEXT;

CREATE TABLE template_repository (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  artifact_repo TEXT NOT NULL,
  artifact_remote TEXT NOT NULL,
  head_commit TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX template_repository_source_unique ON template_repository (organization_id, source_url, source_ref);
CREATE INDEX template_repository_organization_id_idx ON template_repository (organization_id);

CREATE TABLE issue (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES project (id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by_user_id TEXT NOT NULL REFERENCES user (id) ON DELETE RESTRICT,
  closed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX issue_project_number_unique ON issue (project_id, number);
CREATE INDEX issue_organization_id_idx ON issue (organization_id);
CREATE INDEX issue_project_id_idx ON issue (project_id);

ALTER TABLE `workspace` ADD `creation_key` text;
ALTER TABLE `workspace` ADD `branch_name` text;
CREATE UNIQUE INDEX `workspace_project_creation_key_unique` ON `workspace` (`project_id`,`creation_key`);
CREATE UNIQUE INDEX `workspace_project_branch_name_unique` ON `workspace` (`project_id`,`branch_name`);

ALTER TABLE installation ADD COLUMN model_policy TEXT NOT NULL DEFAULT '{"models":[],"defaultModel":null}';
UPDATE installation SET model_policy = COALESCE((
  SELECT json_object(
    'models', json_array(json_object('providerId', preference.provider_id, 'modelId', preference.model_id)),
    'defaultModel', json_object('providerId', preference.provider_id, 'modelId', preference.model_id)
  ) FROM organization_model_preference preference
  WHERE preference.organization_id = installation.organization_id
), model_policy);

CREATE TABLE project_auth_secret (
  project_id TEXT PRIMARY KEY NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  encrypted TEXT NOT NULL,
  iv TEXT NOT NULL
);

CREATE TABLE workspace_pending_prompt (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  error_summary TEXT,
  delivered_at INTEGER
);
CREATE INDEX workspace_pending_prompt_workspace_idx ON workspace_pending_prompt(workspace_id, delivered_at, sequence);
ALTER TABLE workspace ADD COLUMN provisioning_scheduled_at INTEGER;
ALTER TABLE workspace_pending_prompt ADD COLUMN scheduled_at INTEGER;
CREATE INDEX workspace_provisioning_schedule_idx ON workspace(status, provisioning_scheduled_at, created_at);
CREATE INDEX workspace_pending_prompt_schedule_idx ON workspace_pending_prompt(delivered_at, scheduled_at, sequence);

ALTER TABLE workspace ADD COLUMN restart_request TEXT;

ALTER TABLE deployment ADD COLUMN base_deployment_id TEXT;
ALTER TABLE deployment ADD COLUMN recovery_deployment_id TEXT;
ALTER TABLE deployment ADD COLUMN review_json TEXT;
ALTER TABLE deployment ADD COLUMN recovery_json TEXT;
ALTER TABLE deployment ADD COLUMN verification_json TEXT;
ALTER TABLE deployment ADD COLUMN restore_json TEXT;
ALTER TABLE deployment ADD COLUMN mutation_started INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX deployment_one_active_project_idx ON deployment (project_id) WHERE status IN ('queued', 'running');

CREATE TABLE project_resource (
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('worker', 'd1', 'kv', 'r2', 'queue', 'domain')),
  name TEXT NOT NULL,
  resource_id TEXT,
  generation TEXT,
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'active', 'deleted')),
  PRIMARY KEY (account_id, kind, name),
  UNIQUE (account_id, kind, resource_id)
);
CREATE INDEX project_resource_project_idx ON project_resource(project_id, scope);
CREATE TABLE project_resource_operation (
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
  scope TEXT NOT NULL,
  run_id TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('deploying', 'retained', 'cleanup_failed', 'deleted', 'complete')),
  error TEXT,
  inspected_at INTEGER,
  PRIMARY KEY (account_id, project_id, scope)
);
CREATE TABLE project_secret (
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  environment TEXT NOT NULL CHECK (environment IN ('preview', 'production')),
  name TEXT NOT NULL,
  encrypted TEXT NOT NULL,
  iv TEXT NOT NULL,
  PRIMARY KEY (project_id, environment, name)
);
CREATE TABLE project_domain (
  project_id TEXT PRIMARY KEY NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL UNIQUE,
  zone_id TEXT NOT NULL
);
