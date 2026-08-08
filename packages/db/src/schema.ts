import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  bigint,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export type UserStatus = "active" | "deactivated" | "deleted" | "suspended";

export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    status: varchar("status", { length: 16 }).$type<UserStatus>().notNull().default("active"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("user_status_idx").on(table.status),
    check(
      "user_status_check",
      sql`${table.status} in ('active', 'suspended', 'deactivated', 'deleted')`,
    ),
    check(
      "user_deleted_at_check",
      sql`(${table.status} = 'deleted' and ${table.deletedAt} is not null) or (${table.status} <> 'deleted' and ${table.deletedAt} is null)`,
    ),
  ],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("account_user_id_idx").on(table.userId),
    uniqueIndex("account_provider_account_unique").on(table.providerId, table.accountId),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const oauthClients = pgTable(
  "oauth_clients",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().unique(),
    clientSecret: text("client_secret"),
    disabled: boolean("disabled").notNull().default(false),
    skipConsent: boolean("skip_consent"),
    enableEndSession: boolean("enable_end_session"),
    subjectType: text("subject_type"),
    scopes: text("scopes").array(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts").array(),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris").array().notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    grantTypes: text("grant_types").array(),
    responseTypes: text("response_types").array(),
    public: boolean("public"),
    type: text("type"),
    requirePKCE: boolean("require_pkce"),
    referenceId: text("reference_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (table) => [index("oauth_clients_user_id_idx").on(table.userId)],
);

export const oauthRefreshTokens = pgTable(
  "oauth_refresh_tokens",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revoked: timestamp("revoked", { withTimezone: true }),
    authTime: timestamp("auth_time", { withTimezone: true }),
    scopes: text("scopes").array().notNull(),
  },
  (table) => [
    index("oauth_refresh_tokens_client_id_idx").on(table.clientId),
    index("oauth_refresh_tokens_session_id_idx").on(table.sessionId),
    index("oauth_refresh_tokens_user_id_idx").on(table.userId),
  ],
);

export const oauthAccessTokens = pgTable(
  "oauth_access_tokens",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    refreshId: text("refresh_id").references(() => oauthRefreshTokens.id, {
      onDelete: "cascade",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    scopes: text("scopes").array().notNull(),
  },
  (table) => [
    index("oauth_access_tokens_client_id_idx").on(table.clientId),
    index("oauth_access_tokens_session_id_idx").on(table.sessionId),
    index("oauth_access_tokens_user_id_idx").on(table.userId),
    index("oauth_access_tokens_refresh_id_idx").on(table.refreshId),
  ],
);

export const oauthTokenRevocations = pgTable(
  "oauth_token_revocations",
  {
    jti: text("jti").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("oauth_token_revocations_expires_at_idx").on(table.expiresAt),
    index("oauth_token_revocations_session_id_idx").on(table.sessionId),
  ],
);

export const oauthConsents = pgTable(
  "oauth_consents",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    scopes: text("scopes").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("oauth_consents_client_id_idx").on(table.clientId),
    index("oauth_consents_user_id_idx").on(table.userId),
  ],
);

export const jwks = pgTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export const betterAuthSchema = {
  account,
  jwks,
  oauthAccessToken: oauthAccessTokens,
  oauthClient: oauthClients,
  oauthConsent: oauthConsents,
  oauthRefreshToken: oauthRefreshTokens,
  session,
  user,
  verification,
};

export type OrganizationStatus = "active" | "suspended";
export type OrganizationRole = "admin" | "member" | "owner";
export type MembershipStatus = "active" | "suspended";
export type PlatformRole = "platform_admin";
export type ServiceGrantStatus = "active" | "inactive" | "revoked";
export type ServiceStatus = "active" | "inactive";
export type IamCatalogKind = "action" | "resource";

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull().unique(),
    status: varchar("status", { length: 16 })
      .$type<OrganizationStatus>()
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("organizations_name_check", sql`length(trim(${table.name})) > 0`),
    check("organizations_slug_check", sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
    check("organizations_status_check", sql`${table.status} in ('active', 'suspended')`),
  ],
);

export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 16 }).$type<OrganizationRole>().notNull(),
    status: varchar("status", { length: 16 }).$type<MembershipStatus>().notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("organization_members_org_user_unique").on(table.organizationId, table.userId),
    index("organization_members_user_id_idx").on(table.userId),
    check("organization_members_role_check", sql`${table.role} in ('owner', 'admin', 'member')`),
    check("organization_members_status_check", sql`${table.status} in ('active', 'suspended')`),
  ],
);

export const platformRoleAssignments = pgTable(
  "platform_role_assignments",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 32 }).$type<PlatformRole>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.role] }),
    check("platform_role_assignments_role_check", sql`${table.role} in ('platform_admin')`),
  ],
);

export const serviceGrants = pgTable(
  "service_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    service: varchar("service", { length: 63 }).notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 16 })
      .$type<ServiceGrantStatus>()
      .notNull()
      .default("active"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    revokedByUserId: text("revoked_by_user_id").references(() => user.id, {
      onDelete: "restrict",
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("service_grants_current_subject_unique")
      .on(table.organizationId, table.service, table.userId)
      .where(sql`${table.status} <> 'revoked'`),
    index("service_grants_subject_idx").on(table.userId, table.organizationId, table.service),
    check("service_grants_service_check", sql`${table.service} ~ '^[a-z][a-z0-9-]{0,62}$'`),
    check("service_grants_status_check", sql`${table.status} in ('active', 'inactive', 'revoked')`),
    check(
      "service_grants_revocation_check",
      sql`(${table.status} = 'revoked' and ${table.revokedAt} is not null and ${table.revokedByUserId} is not null) or (${table.status} <> 'revoked' and ${table.revokedAt} is null and ${table.revokedByUserId} is null)`,
    ),
  ],
);

export const services = pgTable(
  "services",
  {
    key: varchar("key", { length: 63 }).primaryKey(),
    name: varchar("name", { length: 160 }).notNull(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    status: varchar("status", { length: 16 }).$type<ServiceStatus>().notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("services_key_check", sql`${table.key} ~ '^[a-z][a-z0-9-]{0,62}$'`),
    check("services_name_check", sql`length(trim(${table.name})) > 0`),
    check("services_status_check", sql`${table.status} in ('active', 'inactive')`),
    index("services_owner_idx").on(table.ownerUserId),
  ],
);

export const iamCatalogEntries = pgTable(
  "iam_catalog_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    service: varchar("service", { length: 63 })
      .notNull()
      .references(() => services.key, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 16 }).$type<IamCatalogKind>().notNull(),
    identifier: varchar("identifier", { length: 256 }).notNull(),
    description: varchar("description", { length: 500 }),
    status: varchar("status", { length: 16 }).$type<ServiceStatus>().notNull().default("active"),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("iam_catalog_entries_service_kind_identifier_unique").on(
      table.service,
      table.kind,
      table.identifier,
    ),
    index("iam_catalog_entries_lookup_idx").on(table.service, table.kind, table.status),
    check("iam_catalog_entries_kind_check", sql`${table.kind} in ('action', 'resource')`),
    check("iam_catalog_entries_status_check", sql`${table.status} in ('active', 'inactive')`),
    check(
      "iam_catalog_entries_ownership_check",
      sql`${table.identifier} like ${table.service} || ':%'`,
    ),
  ],
);

export type AuditOutcome = "denied" | "success";

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: text("actor_user_id"),
    action: varchar("action", { length: 128 }).notNull(),
    resourceType: varchar("resource_type", { length: 64 }).notNull(),
    resourceId: text("resource_id"),
    organizationId: uuid("organization_id"),
    outcome: varchar("outcome", { length: 16 }).$type<AuditOutcome>().notNull(),
    requestId: varchar("request_id", { length: 128 }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, string | boolean | number | null>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_events_actor_idx").on(table.actorUserId, table.createdAt),
    index("audit_events_organization_idx").on(table.organizationId, table.createdAt),
    check("audit_events_outcome_check", sql`${table.outcome} in ('success', 'denied')`),
  ],
);

export type InvitationStatus = "accepted" | "cancelled" | "pending";

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 16 }).$type<OrganizationRole>().notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    status: varchar("status", { length: 16 })
      .$type<InvitationStatus>()
      .notNull()
      .default("pending"),
    invitedByUserId: text("invited_by_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("invitations_email_idx").on(table.email),
    index("invitations_organization_idx").on(table.organizationId),
    check("invitations_email_normalized_check", sql`${table.email} = lower(trim(${table.email}))`),
    check("invitations_role_check", sql`${table.role} in ('owner', 'admin', 'member')`),
    check("invitations_status_check", sql`${table.status} in ('pending', 'accepted', 'cancelled')`),
    check("invitations_token_hash_check", sql`length(${table.tokenHash}) = 64`),
  ],
);

export const passwordResetRequests = pgTable(
  "password_reset_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("password_reset_requests_user_idx").on(table.userId),
    check("password_reset_token_hash_check", sql`length(${table.tokenHash}) = 64`),
  ],
);

export const mfaEnrollments = pgTable(
  "mfa_enrollments",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    encryptedSecret: text("encrypted_secret").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    lastUsedCounter: bigint("last_used_counter", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "mfa_last_used_counter_check",
      sql`${table.lastUsedCounter} is null or ${table.lastUsedCounter} >= 0`,
    ),
  ],
);

export const emailVerificationRequests = pgTable(
  "email_verification_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 320 }).notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("email_verification_requests_user_idx").on(table.userId),
    check(
      "email_verification_email_normalized_check",
      sql`${table.email} = lower(trim(${table.email}))`,
    ),
    check("email_verification_token_hash_check", sql`length(${table.tokenHash}) = 64`),
  ],
);

export const systemHealth = pgTable("system_health", {
  id: uuid("id").defaultRandom().primaryKey(),
  component: varchar("component", { length: 64 }).notNull().unique(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
});

export type JobStatus = "available" | "completed" | "failed" | "running";

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: varchar("type", { length: 128 }).notNull(),
    deduplicationKey: varchar("deduplication_key", { length: 160 }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: varchar("status", { length: 16 }).$type<JobStatus>().notNull().default("available"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: varchar("locked_by", { length: 128 }),
    lastError: varchar("last_error", { length: 512 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("jobs_available_idx").on(table.status, table.availableAt),
    uniqueIndex("jobs_deduplication_key_unique").on(table.deduplicationKey),
    check("jobs_attempts_check", sql`${table.attempts} >= 0`),
    check("jobs_max_attempts_check", sql`${table.maxAttempts} > 0`),
    check(
      "jobs_status_check",
      sql`${table.status} in ('available', 'running', 'completed', 'failed')`,
    ),
  ],
);
