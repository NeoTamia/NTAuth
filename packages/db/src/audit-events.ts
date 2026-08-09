import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";

import type { DatabaseConnection } from "./client";
import {
  auditEvents,
  organizationMembers,
  organizations,
  platformRoleAssignments,
  services,
  type AuditOutcome,
} from "./schema";

export const AUDIT_RETENTION_DAYS = 365;
export const AUDIT_PAGE_MAX_SIZE = 100;

type AuditCursor = { createdAt: Date; id: string };
type Actor = { requestId: string; userId: string };
export type IamAuditQuery = {
  action?: string;
  actorUserId?: string;
  cursor?: string;
  from?: Date;
  limit?: number;
  organizationId?: string;
  outcome?: AuditOutcome;
  service?: string;
  to?: Date;
};

export class AuditEventAuthorizationError extends Error {
  constructor() {
    super("Audit event access is not permitted");
    this.name = "AuditEventAuthorizationError";
  }
}

export class AuditEventInputError extends Error {
  constructor() {
    super("Audit event query is invalid");
    this.name = "AuditEventInputError";
  }
}

const IAM_METADATA_KEYS = new Set([
  "active",
  "groupId",
  "idempotent",
  "identifier",
  "policyId",
  "principalId",
  "principalType",
  "service",
  "targetUserId",
  "version",
]);

function retentionCutoff(now: Date) {
  return new Date(now.getTime() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1_000);
}

export function publicIamAuditMetadata(metadata: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(metadata).filter(
      ([key, value]) =>
        IAM_METADATA_KEYS.has(key) &&
        (value === null || ["boolean", "number", "string"].includes(typeof value)),
    ),
  );
}

export function encodeAuditCursor(cursor: AuditCursor) {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`).toString("base64url");
}

export function decodeAuditCursor(value: string): AuditCursor {
  try {
    const [timestamp, id, extra] = Buffer.from(value, "base64url").toString("utf8").split("|");
    const createdAt = new Date(timestamp ?? "");
    if (
      extra !== undefined ||
      !timestamp ||
      !id ||
      Number.isNaN(createdAt.getTime()) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ) {
      throw new Error("invalid cursor");
    }
    return { createdAt, id };
  } catch {
    throw new AuditEventInputError();
  }
}

async function canReadOrganizationAudit(
  connection: DatabaseConnection,
  actorUserId: string,
  organizationId: string,
) {
  const [platform] = await connection.db
    .select({ userId: platformRoleAssignments.userId })
    .from(platformRoleAssignments)
    .where(
      and(
        eq(platformRoleAssignments.userId, actorUserId),
        eq(platformRoleAssignments.role, "platform_admin"),
      ),
    )
    .limit(1);
  if (platform) return true;

  const [member] = await connection.db
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, organizationMembers.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, actorUserId),
        eq(organizationMembers.status, "active"),
        inArray(organizationMembers.role, ["owner", "admin"]),
      ),
    )
    .limit(1);
  return Boolean(member);
}

async function canReadServiceAudit(
  connection: DatabaseConnection,
  actorUserId: string,
  service: string,
) {
  const [allowed] = await connection.db
    .select({ key: services.key })
    .from(services)
    .leftJoin(
      platformRoleAssignments,
      and(
        eq(platformRoleAssignments.userId, actorUserId),
        eq(platformRoleAssignments.role, "platform_admin"),
      ),
    )
    .where(
      and(
        eq(services.key, service),
        eq(services.status, "active"),
        or(eq(services.ownerUserId, actorUserId), eq(platformRoleAssignments.userId, actorUserId)),
      ),
    )
    .limit(1);
  return Boolean(allowed);
}

export async function listIamAuditEvents(
  connection: DatabaseConnection,
  input: IamAuditQuery,
  actor: Actor,
  now = new Date(),
) {
  const limit = input.limit ?? 50;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > AUDIT_PAGE_MAX_SIZE ||
    (!input.organizationId && !input.service) ||
    (input.organizationId !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        input.organizationId,
      )) ||
    (input.action !== undefined && !/^(iam|service-grant)\.[a-z.-]{1,110}$/.test(input.action)) ||
    (input.actorUserId !== undefined &&
      (input.actorUserId.length < 1 || input.actorUserId.length > 128)) ||
    (input.outcome !== undefined && !["denied", "success"].includes(input.outcome)) ||
    (input.service !== undefined && !/^[a-z][a-z0-9-]{0,62}$/.test(input.service)) ||
    (input.from !== undefined && Number.isNaN(input.from.getTime())) ||
    (input.to !== undefined && Number.isNaN(input.to.getTime())) ||
    (input.from !== undefined && input.to !== undefined && input.from >= input.to)
  ) {
    throw new AuditEventInputError();
  }
  const authorized = input.organizationId
    ? await canReadOrganizationAudit(connection, actor.userId, input.organizationId)
    : await canReadServiceAudit(connection, actor.userId, input.service!);
  if (!authorized) {
    throw new AuditEventAuthorizationError();
  }

  const cursor = input.cursor ? decodeAuditCursor(input.cursor) : undefined;
  const rows = await connection.db
    .select()
    .from(auditEvents)
    .where(
      and(
        input.organizationId
          ? eq(auditEvents.organizationId, input.organizationId)
          : isNull(auditEvents.organizationId),
        gte(auditEvents.createdAt, retentionCutoff(now)),
        or(
          sql`${auditEvents.action} like 'iam.%'`,
          sql`${auditEvents.action} like 'service-grant.%'`,
        ),
        input.action ? eq(auditEvents.action, input.action) : undefined,
        input.actorUserId ? eq(auditEvents.actorUserId, input.actorUserId) : undefined,
        input.outcome ? eq(auditEvents.outcome, input.outcome) : undefined,
        input.service ? sql`${auditEvents.metadata}->>'service' = ${input.service}` : undefined,
        input.from ? gte(auditEvents.createdAt, input.from) : undefined,
        input.to ? lt(auditEvents.createdAt, input.to) : undefined,
        cursor
          ? or(
              lt(auditEvents.createdAt, cursor.createdAt),
              and(eq(auditEvents.createdAt, cursor.createdAt), lt(auditEvents.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    events: page.map((event) => ({
      action: event.action,
      actor: { id: event.actorUserId, type: event.actorUserId ? "user" : "system" },
      correlationId: event.requestId,
      createdAt: event.createdAt,
      id: event.id,
      metadata: publicIamAuditMetadata(event.metadata),
      outcome: event.outcome,
      scope: {
        organizationId: event.organizationId,
        service: typeof event.metadata.service === "string" ? event.metadata.service : null,
      },
      target: { id: event.resourceId, type: event.resourceType },
    })),
    nextCursor:
      rows.length > limit && last
        ? encodeAuditCursor({ createdAt: last.createdAt, id: last.id })
        : null,
    retentionDays: AUDIT_RETENTION_DAYS,
  };
}

export async function exportIamAuditEvents(
  connection: DatabaseConnection,
  input: Omit<IamAuditQuery, "cursor" | "limit">,
  actor: Actor,
  now = new Date(),
) {
  const events: Awaited<ReturnType<typeof listIamAuditEvents>>["events"] = [];
  let cursor: string | undefined;
  let retentionDays = AUDIT_RETENTION_DAYS;
  try {
    const collect = async (): Promise<void> => {
      const page = await listIamAuditEvents(
        connection,
        { ...input, cursor, limit: AUDIT_PAGE_MAX_SIZE },
        actor,
        now,
      );
      events.push(...page.events);
      retentionDays = page.retentionDays;
      cursor = page.nextCursor ?? undefined;
      if (cursor && events.length < 10_000) await collect();
    };
    await collect();
  } catch (error) {
    if (error instanceof AuditEventAuthorizationError) {
      await connection.db.insert(auditEvents).values({
        action: "iam.audit.export",
        actorUserId: actor.userId,
        metadata: { service: input.service ?? null },
        organizationId: input.organizationId,
        outcome: "denied",
        requestId: actor.requestId,
        resourceType: "audit_export",
      });
    }
    throw error;
  }
  await connection.db.insert(auditEvents).values({
    action: "iam.audit.export",
    actorUserId: actor.userId,
    metadata: { count: events.length, service: input.service ?? null },
    organizationId: input.organizationId,
    outcome: "success",
    requestId: actor.requestId,
    resourceType: "audit_export",
  });
  return { events, retentionDays, truncated: Boolean(cursor) };
}

export async function purgeExpiredAuditEvents(connection: DatabaseConnection, now = new Date()) {
  return connection.db.transaction(async (transaction) => {
    await transaction.execute(sql`select set_config('ntauth.audit_purge', 'enabled', true)`);
    return transaction
      .delete(auditEvents)
      .where(lt(auditEvents.createdAt, retentionCutoff(now)))
      .returning({ id: auditEvents.id });
  });
}
