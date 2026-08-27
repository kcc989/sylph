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
    errorSummary: text("error_summary"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [
    index("workspace_organization_id_idx").on(table.organizationId),
    index("workspace_project_id_idx").on(table.projectId),
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
    modelId: text("model_id").notNull(),
    authMethod: text("auth_method").notNull(),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(false),
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
    modelId: text("model_id").notNull(),
    authMethod: text("auth_method").notNull(),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(false),
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
