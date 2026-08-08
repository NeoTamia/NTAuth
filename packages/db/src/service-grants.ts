import { and, eq, inArray, ne } from "drizzle-orm";

import type { DatabaseConnection } from "./client";
import {
  auditEvents,
  organizationMembers,
  organizations,
  platformRoleAssignments,
  serviceGrants,
  services,
  type ServiceGrantStatus,
} from "./schema";

type Actor = { requestId: string; userId: string };
type Transaction = Parameters<Parameters<DatabaseConnection["db"]["transaction"]>[0]>[0];

export class ServiceGrantAuthorizationError extends Error {
  constructor() {
    super("The actor is not allowed to manage this service grant");
    this.name = "ServiceGrantAuthorizationError";
  }
}

export class ServiceGrantConflictError extends Error {
  constructor() {
    super("A current service grant already exists");
    this.name = "ServiceGrantConflictError";
  }
}

export class ServiceGrantNotFoundError extends Error {
  constructor() {
    super("Service grant not found");
    this.name = "ServiceGrantNotFoundError";
  }
}

function validService(service: string) {
  return /^[a-z][a-z0-9-]{0,62}$/.test(service);
}

async function canManage(transaction: Transaction, actorUserId: string, organizationId: string) {
  const [platformRole] = await transaction
    .select({ userId: platformRoleAssignments.userId })
    .from(platformRoleAssignments)
    .where(
      and(
        eq(platformRoleAssignments.userId, actorUserId),
        eq(platformRoleAssignments.role, "platform_admin"),
      ),
    )
    .limit(1);
  if (platformRole) return true;
  const [membership] = await transaction
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
  return Boolean(membership);
}

async function targetBelongsToOrganization(
  transaction: Transaction,
  organizationId: string,
  userId: string,
) {
  const [membership] = await transaction
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
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.status, "active"),
      ),
    )
    .limit(1);
  return Boolean(membership);
}

async function auditDenied(
  transaction: Transaction,
  action: string,
  input: { grantId?: string; organizationId: string; service?: string; userId?: string },
  actor: Actor,
) {
  await transaction.insert(auditEvents).values({
    action,
    actorUserId: actor.userId,
    metadata: {
      service: input.service ?? null,
      targetUserId: input.userId ?? null,
    },
    organizationId: input.organizationId,
    outcome: "denied",
    requestId: actor.requestId,
    resourceId: input.grantId,
    resourceType: "service_grant",
  });
}

export async function hasActiveServiceGrant(
  connection: DatabaseConnection,
  input: { organizationId: string; service: string; userId: string },
) {
  if (!validService(input.service)) return false;
  const [grant] = await connection.db
    .select({ id: serviceGrants.id })
    .from(serviceGrants)
    .innerJoin(
      organizationMembers,
      and(
        eq(organizationMembers.organizationId, serviceGrants.organizationId),
        eq(organizationMembers.userId, serviceGrants.userId),
        eq(organizationMembers.status, "active"),
      ),
    )
    .innerJoin(
      organizations,
      and(eq(organizations.id, serviceGrants.organizationId), eq(organizations.status, "active")),
    )
    .where(
      and(
        eq(serviceGrants.organizationId, input.organizationId),
        eq(serviceGrants.service, input.service),
        eq(serviceGrants.userId, input.userId),
        eq(serviceGrants.status, "active"),
      ),
    )
    .limit(1);
  return Boolean(grant);
}

export async function createServiceGrant(
  connection: DatabaseConnection,
  input: { active?: boolean; organizationId: string; service: string; userId: string },
  actor: Actor,
) {
  if (!validService(input.service)) throw new ServiceGrantConflictError();
  let result:
    | { kind: "denied" }
    | { kind: "conflict" }
    | { grant: typeof serviceGrants.$inferSelect; kind: "success" };
  try {
    result = await connection.db.transaction(async (transaction) => {
      if (
        !(await canManage(transaction, actor.userId, input.organizationId)) ||
        !(await targetBelongsToOrganization(transaction, input.organizationId, input.userId))
      ) {
        await auditDenied(transaction, "service-grant.create", input, actor);
        return { kind: "denied" as const };
      }
      const [availableService] = await transaction
        .select({ key: services.key })
        .from(services)
        .where(and(eq(services.key, input.service), eq(services.status, "active")))
        .limit(1);
      if (!availableService) return { kind: "conflict" as const };
      const [existing] = await transaction
        .select({ id: serviceGrants.id })
        .from(serviceGrants)
        .where(
          and(
            eq(serviceGrants.organizationId, input.organizationId),
            eq(serviceGrants.service, input.service),
            eq(serviceGrants.userId, input.userId),
            ne(serviceGrants.status, "revoked"),
          ),
        )
        .limit(1);
      if (existing) return { kind: "conflict" as const };
      const [grant] = await transaction
        .insert(serviceGrants)
        .values({
          createdByUserId: actor.userId,
          organizationId: input.organizationId,
          service: input.service,
          status: input.active === false ? "inactive" : "active",
          userId: input.userId,
        })
        .returning();
      await transaction.insert(auditEvents).values({
        action: "service-grant.create",
        actorUserId: actor.userId,
        metadata: { service: input.service, targetUserId: input.userId },
        organizationId: input.organizationId,
        outcome: "success",
        requestId: actor.requestId,
        resourceId: grant!.id,
        resourceType: "service_grant",
      });
      return { grant: grant!, kind: "success" as const };
    });
  } catch (error) {
    let current = error;
    while (current && typeof current === "object") {
      if ("code" in current && (current as { code?: unknown }).code === "23505") {
        throw new ServiceGrantConflictError();
      }
      current = "cause" in current ? (current as { cause?: unknown }).cause : undefined;
    }
    throw error;
  }
  if (result.kind === "denied") throw new ServiceGrantAuthorizationError();
  if (result.kind === "conflict") throw new ServiceGrantConflictError();
  return result.grant;
}

async function loadGrant(transaction: Transaction, grantId: string) {
  const [grant] = await transaction
    .select()
    .from(serviceGrants)
    .where(eq(serviceGrants.id, grantId))
    .limit(1);
  return grant;
}

export async function setServiceGrantActive(
  connection: DatabaseConnection,
  input: { active: boolean; grantId: string },
  actor: Actor,
) {
  const result = await connection.db.transaction(async (transaction) => {
    const current = await loadGrant(transaction, input.grantId);
    if (!current) return { kind: "missing" as const };
    if (!(await canManage(transaction, actor.userId, current.organizationId))) {
      await auditDenied(
        transaction,
        "service-grant.status.change",
        { ...current, grantId: current.id },
        actor,
      );
      return { kind: "denied" as const };
    }
    if (current.status === "revoked") return { kind: "missing" as const };
    const status: ServiceGrantStatus = input.active ? "active" : "inactive";
    const [grant] = await transaction
      .update(serviceGrants)
      .set({ status, updatedAt: new Date() })
      .where(eq(serviceGrants.id, input.grantId))
      .returning();
    await transaction.insert(auditEvents).values({
      action: "service-grant.status.change",
      actorUserId: actor.userId,
      metadata: { active: input.active, service: current.service, targetUserId: current.userId },
      organizationId: current.organizationId,
      outcome: "success",
      requestId: actor.requestId,
      resourceId: current.id,
      resourceType: "service_grant",
    });
    return { grant: grant!, kind: "success" as const };
  });
  if (result.kind === "denied") throw new ServiceGrantAuthorizationError();
  if (result.kind === "missing") throw new ServiceGrantNotFoundError();
  return result.grant;
}

export async function revokeServiceGrant(
  connection: DatabaseConnection,
  grantId: string,
  actor: Actor,
) {
  const result = await connection.db.transaction(async (transaction) => {
    const current = await loadGrant(transaction, grantId);
    if (!current) return { kind: "missing" as const };
    if (!(await canManage(transaction, actor.userId, current.organizationId))) {
      await auditDenied(
        transaction,
        "service-grant.revoke",
        { ...current, grantId: current.id },
        actor,
      );
      return { kind: "denied" as const };
    }
    if (current.status === "revoked") return { grant: current, kind: "success" as const };
    const now = new Date();
    const [grant] = await transaction
      .update(serviceGrants)
      .set({
        revokedAt: now,
        revokedByUserId: actor.userId,
        status: "revoked",
        updatedAt: now,
      })
      .where(eq(serviceGrants.id, grantId))
      .returning();
    await transaction.insert(auditEvents).values({
      action: "service-grant.revoke",
      actorUserId: actor.userId,
      metadata: { service: current.service, targetUserId: current.userId },
      organizationId: current.organizationId,
      outcome: "success",
      requestId: actor.requestId,
      resourceId: current.id,
      resourceType: "service_grant",
    });
    return { grant: grant!, kind: "success" as const };
  });
  if (result.kind === "denied") throw new ServiceGrantAuthorizationError();
  if (result.kind === "missing") throw new ServiceGrantNotFoundError();
  return result.grant;
}

export async function listServiceGrants(
  connection: DatabaseConnection,
  input: { organizationId: string; service?: string; userId?: string },
  actor: Actor,
) {
  const result = await connection.db.transaction(async (transaction) => {
    if (!(await canManage(transaction, actor.userId, input.organizationId))) {
      await auditDenied(transaction, "service-grant.list", input, actor);
      return { kind: "denied" as const };
    }
    const grants = await transaction
      .select()
      .from(serviceGrants)
      .where(
        and(
          eq(serviceGrants.organizationId, input.organizationId),
          input.service ? eq(serviceGrants.service, input.service) : undefined,
          input.userId ? eq(serviceGrants.userId, input.userId) : undefined,
        ),
      );
    return { grants, kind: "success" as const };
  });
  if (result.kind === "denied") throw new ServiceGrantAuthorizationError();
  return result.grants;
}
