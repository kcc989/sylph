CREATE TABLE user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

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

CREATE TABLE verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE organization (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  logo TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER
);

CREATE TABLE member (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

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
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  import_origin_url TEXT,
  import_origin_branch TEXT,
  upstream_head TEXT,
  upstream_status TEXT NOT NULL DEFAULT 'disconnected',
  upstream_synced_at INTEGER,
  delivery_mode TEXT NOT NULL DEFAULT 'pull_request',
  delivered_commit TEXT,
  delivery_url TEXT,
  template_key TEXT,
  template_repo TEXT,
  template_commit TEXT
);

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
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  base_commit TEXT,
  fork_head TEXT,
  accepted_commit TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  merge_status TEXT NOT NULL DEFAULT 'unreviewed',
  latest_checkpoint_at INTEGER,
  archived_at INTEGER,
  fork_deleted_at INTEGER,
  `creation_key` text,
  `branch_name` text,
  provisioning_scheduled_at INTEGER,
  restart_request TEXT,
  repair_commit TEXT
);

CREATE TABLE magic_link_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  url TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

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

CREATE TABLE `installation` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text,
  `claimed_by_user_id` text,
  `claimed_at` integer,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  model_policy TEXT NOT NULL DEFAULT '{"models":[],"defaultModel":null}',
  FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY (`claimed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);

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

CREATE TABLE `organization_provider_model` (
  `organization_id` text NOT NULL,
  `provider_id` text NOT NULL,
  `model_id` text NOT NULL,
  `name` text NOT NULL,
  `discovered_at` integer DEFAULT (unixepoch()) NOT NULL,
  PRIMARY KEY (`organization_id`, `provider_id`, `model_id`),
  FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `user_provider_model` (
  `user_id` text NOT NULL,
  `provider_id` text NOT NULL,
  `model_id` text NOT NULL,
  `name` text NOT NULL,
  `discovered_at` integer DEFAULT (unixepoch()) NOT NULL,
  PRIMARY KEY (`user_id`, `provider_id`, `model_id`),
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);

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

CREATE TABLE `user_model_preference` (
  `user_id` text PRIMARY KEY NOT NULL,
  `provider_id` text NOT NULL,
  `model_id` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);

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
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  base_deployment_id TEXT,
  recovery_deployment_id TEXT,
  review_json TEXT,
  recovery_json TEXT,
  verification_json TEXT,
  restore_json TEXT,
  mutation_started INTEGER NOT NULL DEFAULT 0,
  identity_json TEXT,
  managed_release INTEGER NOT NULL DEFAULT 0,
  capture_evidence INTEGER NOT NULL DEFAULT 0
);

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
  delivered_at INTEGER,
  scheduled_at INTEGER
);

CREATE TABLE installation_github_app (
  id TEXT PRIMARY KEY NOT NULL,
  encrypted TEXT NOT NULL,
  iv TEXT NOT NULL
);

CREATE TABLE installation_setup_session (
  id TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL,
  github_state TEXT,
  github_origin TEXT
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

CREATE TABLE project_resource (
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('worker', 'd1', 'kv', 'r2', 'queue', 'domain', 'durable_object', 'workflow')),
  name TEXT NOT NULL,
  resource_id TEXT,
  generation TEXT,
  purpose TEXT NOT NULL DEFAULT 'application' CHECK (purpose IN ('application', 'recovery_control')),
  state TEXT NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'active', 'retired', 'deleted')),
  PRIMARY KEY (account_id, kind, name),
  UNIQUE (account_id, kind, resource_id)
);

CREATE TABLE project_resource_operation (
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
  scope TEXT NOT NULL,
  run_id TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('deploying', 'retained', 'cleanup_failed', 'deleted', 'complete', 'maintaining')),
  error TEXT,
  inspected_at INTEGER,
  PRIMARY KEY (account_id, project_id, scope)
);

CREATE TABLE project_resource_review (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE RESTRICT,
  review_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reviewed', 'confirmed', 'running', 'complete', 'failed')),
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE project_deployment_capability (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  run_id TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE project_deployment_resource (
  project_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  PRIMARY KEY (account_id, project_id, scope, kind, name)
);

CREATE TABLE project_deployment_state (
  project_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  state_key TEXT NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (project_id, scope, state_key)
);

CREATE TABLE project_preview_cleanup_request (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  run_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  confirmed_scope TEXT NOT NULL,
  previous_status TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'preparing',
  terminal_status TEXT,
  confirmed_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX user_email_unique ON user (email);

CREATE UNIQUE INDEX session_token_unique ON session (token);

CREATE INDEX session_user_id_idx ON session (user_id);

CREATE INDEX account_user_id_idx ON account (user_id);

CREATE UNIQUE INDEX account_issuer_account_id_unique ON account (issuer, account_id);

CREATE INDEX verification_identifier_idx ON verification (identifier);

CREATE UNIQUE INDEX organization_slug_unique ON organization (slug);

CREATE UNIQUE INDEX member_organization_user_unique ON member (organization_id, user_id);

CREATE INDEX member_user_id_idx ON member (user_id);

CREATE INDEX invitation_organization_id_idx ON invitation (organization_id);

CREATE INDEX invitation_email_idx ON invitation (email);

CREATE UNIQUE INDEX project_organization_slug_unique ON project (organization_id, slug);

CREATE INDEX workspace_organization_id_idx ON workspace (organization_id);

CREATE INDEX workspace_project_id_idx ON workspace (project_id);

CREATE INDEX magic_link_outbox_email_idx ON magic_link_outbox (email);

CREATE UNIQUE INDEX repository_operation_workspace_kind_id_unique ON repository_operation (workspace_id, kind, id);

CREATE INDEX repository_operation_workspace_id_idx ON repository_operation (workspace_id);

CREATE INDEX `open_code_connection_organization_id_idx` ON `open_code_connection` (`organization_id`);

CREATE INDEX `user_open_code_connection_user_id_idx` ON `user_open_code_connection` (`user_id`);

CREATE INDEX `organization_provider_model_organization_id_idx` ON `organization_provider_model` (`organization_id`);

CREATE INDEX `user_provider_model_user_id_idx` ON `user_provider_model` (`user_id`);

CREATE INDEX deployment_project_id_idx ON deployment (project_id);

CREATE INDEX deployment_project_commit_idx ON deployment (project_id, "commit");

CREATE UNIQUE INDEX workspace_review_revision_unique ON workspace_review (workspace_id, "commit");

CREATE INDEX workspace_review_workspace_id_idx ON workspace_review (workspace_id);

CREATE INDEX workspace_review_comment_review_id_idx ON workspace_review_comment (review_id);

CREATE UNIQUE INDEX skill_installation_scope_name_unique
  ON skill_installation (scope, target_id, name);

CREATE INDEX skill_installation_organization_id_idx
  ON skill_installation (organization_id);

CREATE INDEX skill_installation_project_id_idx
  ON skill_installation (project_id);

CREATE INDEX agent_sessions_workspace_id_idx ON agent_sessions (workspace_id);

CREATE UNIQUE INDEX agent_sessions_opencode_session_unique ON agent_sessions (workspace_id, opencode_session_id);

CREATE INDEX ci_runs_project_created_idx ON ci_runs (project_id, created_at);

CREATE INDEX ci_runs_workspace_id_idx ON ci_runs (workspace_id);

CREATE INDEX ci_runs_commit_sha_idx ON ci_runs (commit_sha);

CREATE UNIQUE INDEX template_repository_source_unique ON template_repository (organization_id, source_url, source_ref);

CREATE INDEX template_repository_organization_id_idx ON template_repository (organization_id);

CREATE UNIQUE INDEX issue_project_number_unique ON issue (project_id, number);

CREATE INDEX issue_organization_id_idx ON issue (organization_id);

CREATE INDEX issue_project_id_idx ON issue (project_id);

CREATE UNIQUE INDEX `workspace_project_creation_key_unique` ON `workspace` (`project_id`,`creation_key`);

CREATE UNIQUE INDEX `workspace_project_branch_name_unique` ON `workspace` (`project_id`,`branch_name`);

CREATE INDEX workspace_pending_prompt_workspace_idx ON workspace_pending_prompt(workspace_id, delivered_at, sequence);

CREATE INDEX workspace_provisioning_schedule_idx ON workspace(status, provisioning_scheduled_at, created_at);

CREATE INDEX workspace_pending_prompt_schedule_idx ON workspace_pending_prompt(delivered_at, scheduled_at, sequence);

CREATE UNIQUE INDEX deployment_one_active_project_idx ON deployment (project_id) WHERE status IN ('queued', 'running');

CREATE INDEX project_incident_recent ON project_incident(project_id, last_seen DESC);

CREATE INDEX project_resource_project_idx ON project_resource(project_id, scope);

CREATE UNIQUE INDEX project_preview_cleanup_active ON project_preview_cleanup_request(project_id, account_id, scope) WHERE status IN ('preparing', 'dispatched');

INSERT INTO installation (id) VALUES ('default');
