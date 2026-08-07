import { and, eq, inArray } from "drizzle-orm";

import type { DatabaseConnection } from "./client";
import {
  auditEvents,
  organizationMembers,
  organizations,
  platformRoleAssignments,
  type OrganizationRole,
} from "./schema";

type Actor = {
  requestId: string;
  userId: string;
};

export class OrganizationAuthorizationError extends Error {
  constructor() {
    super("The actor is not allowed to manage this organization");
    this.name = "OrganizationAuthorizationError";
  }
}

async function canManageOrganization(
  transaction: Parameters<Parameters<DatabaseConnection["db"]["transaction"]>[0]>[0],
  actorUserId: string,
  organizationId?: string,
): Promise<boolean> {
  const platformRole = await transaction
    .select({ userId: platformRoleAssignments.userId })
    .from(platformRoleAssignments)
    .where(
      and(
        eq(platformRoleAssignments.userId, actorUserId),
        eq(platformRoleAssignments.role, "platform_admin"),
      ),
    )
    .limit(1);

  if (platformRole.length > 0) return true;
  if (!organizationId) return false;

  const membership = await transaction
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, actorUserId),
        eq(organizationMembers.status, "active"),
        inArray(organizationMembers.role, ["owner", "admin"]),
      ),
    )
    .limit(1);

  return membership.length > 0;
}

export async function createOrganization(
  connection: DatabaseConnection,
  input: { name: string; slug: string },
  actor: Actor,
) {
  const result = await connection.db.transaction(async (transaction) => {
    const authorized = await canManageOrganization(transaction, actor.userId);

    if (!authorized) {
      await transaction.insert(auditEvents).values({
        action: "organization.create",
        actorUserId: actor.userId,
        metadata: { slug: input.slug },
        outcome: "denied",
        requestId: actor.requestId,
        resourceType: "organization",
      });
      return null;
    }

    const [organization] = await transaction.insert(organizations).values(input).returning();

    await transaction.insert(auditEvents).values({
      action: "organization.create",
      actorUserId: actor.userId,
      metadata: { slug: input.slug },
      organizationId: organization!.id,
      outcome: "success",
      requestId: actor.requestId,
      resourceId: organization!.id,
      resourceType: "organization",
    });
    return organization!;
  });

  if (!result) throw new OrganizationAuthorizationError();
  return result;
}

export async function addOrganizationMember(
  connection: DatabaseConnection,
  input: { organizationId: string; role: OrganizationRole; userId: string },
  actor: Actor,
) {
  const result = await connection.db.transaction(async (transaction) => {
    const authorized = await canManageOrganization(transaction, actor.userId, input.organizationId);

    if (!authorized) {
      await transaction.insert(auditEvents).values({
        action: "organization.member.add",
        actorUserId: actor.userId,
        metadata: { role: input.role, targetUserId: input.userId },
        organizationId: input.organizationId,
        outcome: "denied",
        requestId: actor.requestId,
        resourceId: input.userId,
        resourceType: "organization_member",
      });
      return null;
    }

    const [membership] = await transaction.insert(organizationMembers).values(input).returning();
    await transaction.insert(auditEvents).values({
      action: "organization.member.add",
      actorUserId: actor.userId,
      metadata: { role: input.role, targetUserId: input.userId },
      organizationId: input.organizationId,
      outcome: "success",
      requestId: actor.requestId,
      resourceId: membership!.id,
      resourceType: "organization_member",
    });
    return membership!;
  });

  if (!result) throw new OrganizationAuthorizationError();
  return result;
}

export async function changeOrganizationMemberRole(
  connection: DatabaseConnection,
  input: { organizationId: string; role: OrganizationRole; userId: string },
  actor: Actor,
) {
  const result = await connection.db.transaction(async (transaction) => {
    const authorized = await canManageOrganization(transaction, actor.userId, input.organizationId);

    if (!authorized) {
      await transaction.insert(auditEvents).values({
        action: "organization.member.role.change",
        actorUserId: actor.userId,
        metadata: { role: input.role, targetUserId: input.userId },
        organizationId: input.organizationId,
        outcome: "denied",
        requestId: actor.requestId,
        resourceId: input.userId,
        resourceType: "organization_member",
      });
      return null;
    }

    const [membership] = await transaction
      .update(organizationMembers)
      .set({ role: input.role, updatedAt: new Date() })
      .where(
        and(
          eq(organizationMembers.organizationId, input.organizationId),
          eq(organizationMembers.userId, input.userId),
        ),
      )
      .returning();

    if (!membership) throw new Error("Organization membership not found");

    await transaction.insert(auditEvents).values({
      action: "organization.member.role.change",
      actorUserId: actor.userId,
      metadata: { role: input.role, targetUserId: input.userId },
      organizationId: input.organizationId,
      outcome: "success",
      requestId: actor.requestId,
      resourceId: membership.id,
      resourceType: "organization_member",
    });
    return membership;
  });

  if (!result) throw new OrganizationAuthorizationError();
  return result;
}
