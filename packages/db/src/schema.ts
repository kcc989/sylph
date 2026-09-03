import { sql } from "drizzle-orm"
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

const timestamp = (name: string) =>
  integer(name, { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`)

export const user = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "boolean" })
      .notNull()
      .default(false),
    image: text("image"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [uniqueIndex("user_email_unique").on(table.email)]
)

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_organization_id"),
  },
  (table) => [
    uniqueIndex("session_token_unique").on(table.token),
    index("session_user_id_idx").on(table.userId),
  ]
)

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    issuer: text("issuer").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("account_user_id_idx").on(table.userId),
    uniqueIndex("account_issuer_account_id_unique").on(
      table.issuer,
      table.accountId
    ),
  ]
)

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
)

export const magicLinkOutbox = sqliteTable(
  "magic_link_outbox",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    url: text("url").notNull(),
    createdAt: timestamp("created_at"),
  },
  (table) => [index("magic_link_outbox_email_idx").on(table.email)]
)

export const organization = sqliteTable(
  "organization",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    logo: text("logo"),
    metadata: text("metadata"),
    createdAt: timestamp("created_at"),
    updatedAt: integer("updated_at", { mode: "timestamp" }),
  },
  (table) => [uniqueIndex("organization_slug_unique").on(table.slug)]
)

export const member = sqliteTable(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    uniqueIndex("member_organization_user_unique").on(
      table.organizationId,
      table.userId
    ),
    index("member_user_id_idx").on(table.userId),
  ]
)

export const invitation = sqliteTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull().default("pending"),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    index("invitation_organization_id_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ]
)

export const installation = sqliteTable("installation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id").references(() => organization.id, {
    onDelete: "restrict",
  }),
  claimedByUserId: text("claimed_by_user_id").references(() => user.id, {
    onDelete: "restrict",
  }),
  claimedAt: integer("claimed_at", { mode: "timestamp" }),
  createdAt: timestamp("created_at"),
})

export const project = sqliteTable(
  "project",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    artifactRepoId: text("artifact_repo_id").notNull(),
    artifactRepo: text("artifact_repo").notNull(),
    artifactRemote: text("artifact_remote").notNull(),
    defaultBranch: text("default_branch").notNull().default("main"),
    importOriginUrl: text("import_origin_url"),
    importOriginBranch: text("import_origin_branch"),
    upstreamHead: text("upstream_head"),
    upstreamStatus: text("upstream_status").notNull().default("disconnected"),
    upstreamSyncedAt: integer("upstream_synced_at", { mode: "timestamp" }),
    deliveryMode: text("delivery_mode").notNull().default("pull_request"),
    deliveredCommit: text("delivered_commit"),
    deliveryUrl: text("delivery_url"),
    templateKey: text("template_key"),
    templateRepo: text("template_repo"),
    templateCommit: text("template_commit"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    uniqueIndex("project_organization_slug_unique").on(
      table.organizationId,
      table.slug
    ),
  ]
)

export const templateRepository = sqliteTable(
  "template_repository",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceRef: text("source_ref").notNull(),
    artifactRepo: text("artifact_repo").notNull(),
    artifactRemote: text("artifact_remote").notNull(),
    headCommit: text("head_commit").notNull(),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    uniqueIndex("template_repository_source_unique").on(
      table.organizationId,
      table.sourceUrl,
      table.sourceRef
    ),
    index("template_repository_organization_id_idx").on(table.organizationId),
  ]
)

export const workspace = sqliteTable(
  "workspace",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    status: text("status").notNull().default("provisioning"),
    repositoryMode: text("repository_mode").notNull().default("base"),
    baseArtifactRepo: text("base_artifact_repo").notNull(),
    workspaceArtifactRepo: text("workspace_artifact_repo").notNull(),
    baseCommit: text("base_commit"),
    forkHead: text("fork_head"),
    acceptedCommit: text("accepted_commit"),
    syncStatus: text("sync_status").notNull().default("pending"),
    mergeStatus: text("merge_status").notNull().default("unreviewed"),
    latestCheckpointAt: integer("latest_checkpoint_at", { mode: "timestamp" }),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    forkDeletedAt: integer("fork_deleted_at", { mode: "timestamp" }),
    errorSummary: text("error_summary"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("workspace_organization_id_idx").on(table.organizationId),
    index("workspace_project_id_idx").on(table.projectId),
  ]
)

export const skillInstallation = sqliteTable(
  "skill_installation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => project.id, {
      onDelete: "cascade",
    }),
    scope: text("scope").notNull(),
    targetId: text("target_id").notNull(),
    catalogId: text("catalog_id").notNull(),
    source: text("source").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceHash: text("source_hash"),
    name: text("name").notNull(),
    description: text("description"),
    disableModelInvocation: integer("disable_model_invocation", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    userInvokable: integer("user_invokable", { mode: "boolean" })
      .notNull()
      .default(true),
    files: text("files", { mode: "json" })
      .$type<ReadonlyArray<{ path: string; content: string }>>()
      .notNull(),
    installedByUserId: text("installed_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    uniqueIndex("skill_installation_scope_name_unique").on(
      table.scope,
      table.targetId,
      table.name
    ),
    index("skill_installation_organization_id_idx").on(table.organizationId),
    index("skill_installation_project_id_idx").on(table.projectId),
  ]
)

export const agentSession = sqliteTable(
  "agent_sessions",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    opencodeSessionId: text("opencode_session_id").notNull(),
    parentSessionId: text("parent_session_id"),
    title: text("title").notNull(),
    status: text("status").notNull().default("ready"),
    modelOverride: text("model_override"),
    reasoningOverride: text("reasoning_override"),
    latestAttentionAt: integer("latest_attention_at", { mode: "timestamp" }),
    lastReadAt: integer("last_read_at", { mode: "timestamp" }),
    archivedAt: integer("archived_at", { mode: "timestamp" }),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("agent_sessions_workspace_id_idx").on(table.workspaceId),
    uniqueIndex("agent_sessions_opencode_session_unique").on(
      table.workspaceId,
      table.opencodeSessionId
    ),
  ]
)

export const ciRun = sqliteTable(
  "ci_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    agentSessionId: text("agent_session_id"),
    workflowInstanceId: text("workflow_instance_id").notNull(),
    commitSha: text("commit_sha").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("queued"),
    summaryJson: text("summary_json"),
    startedAt: integer("started_at", { mode: "timestamp" }),
    finishedAt: integer("finished_at", { mode: "timestamp" }),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("ci_runs_project_created_idx").on(table.projectId, table.createdAt),
    index("ci_runs_workspace_id_idx").on(table.workspaceId),
    index("ci_runs_commit_sha_idx").on(table.commitSha),
  ]
)

export const workspaceReview = sqliteTable(
  "workspace_review",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    commit: text("commit").notNull(),
    decision: text("decision").notNull().default("pending"),
    reviewerUserId: text("reviewer_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    submittedAt: integer("submitted_at", { mode: "timestamp" }),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    uniqueIndex("workspace_review_revision_unique").on(
      table.workspaceId,
      table.commit
    ),
    index("workspace_review_workspace_id_idx").on(table.workspaceId),
  ]
)

export const workspaceReviewComment = sqliteTable(
  "workspace_review_comment",
  {
    id: text("id").primaryKey(),
    reviewId: text("review_id")
      .notNull()
      .references(() => workspaceReview.id, { onDelete: "cascade" }),
    file: text("file").notNull(),
    side: text("side").notNull(),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    body: text("body").notNull(),
    authorUserId: text("author_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
    resolvedByUserId: text("resolved_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("workspace_review_comment_review_id_idx").on(table.reviewId),
  ]
)

export const deployment = sqliteTable(
  "deployment",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    commit: text("commit").notNull(),
    status: text("status").notNull().default("queued"),
    productionUrl: text("production_url"),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    failureDetails: text("failure_details"),
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("deployment_project_id_idx").on(table.projectId),
    index("deployment_project_commit_idx").on(table.projectId, table.commit),
  ]
)

export const repositoryOperation = sqliteTable(
  "repository_operation",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    commit: text("commit"),
    errorSummary: text("error_summary"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    uniqueIndex("repository_operation_workspace_kind_id_unique").on(
      table.workspaceId,
      table.kind,
      table.id
    ),
    index("repository_operation_workspace_id_idx").on(table.workspaceId),
  ]
)

export const openCodeConnection = sqliteTable(
  "open_code_connection",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    configuredByUserId: text("configured_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    providerId: text("provider_id").notNull(),
    authMethod: text("auth_method").notNull(),
    encryptedCredential: text("encrypted_credential").notNull(),
    encryptionIv: text("encryption_iv").notNull(),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.providerId] }),
    index("open_code_connection_organization_id_idx").on(table.organizationId),
  ]
)

export const userOpenCodeConnection = sqliteTable(
  "user_open_code_connection",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    authMethod: text("auth_method").notNull(),
    encryptedCredential: text("encrypted_credential").notNull(),
    encryptionIv: text("encryption_iv").notNull(),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.providerId] }),
    index("user_open_code_connection_user_id_idx").on(table.userId),
  ]
)

export const organizationProviderModel = sqliteTable(
  "organization_provider_model",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
    name: text("name").notNull(),
    discoveredAt: timestamp("discovered_at"),
  },
  (table) => [
    primaryKey({
      columns: [table.organizationId, table.providerId, table.modelId],
    }),
    index("organization_provider_model_organization_id_idx").on(
      table.organizationId
    ),
  ]
)

export const userProviderModel = sqliteTable(
  "user_provider_model",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
    name: text("name").notNull(),
    discoveredAt: timestamp("discovered_at"),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.providerId, table.modelId] }),
    index("user_provider_model_user_id_idx").on(table.userId),
  ]
)

export const organizationModelPreference = sqliteTable(
  "organization_model_preference",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
    configuredByUserId: text("configured_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  }
)

export const userModelPreference = sqliteTable("user_model_preference", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  providerId: text("provider_id").notNull(),
  modelId: text("model_id").notNull(),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
})
