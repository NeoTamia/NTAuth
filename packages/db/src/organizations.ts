import { and, eq, inArray } from "drizzle-orm";

import type { DatabaseConnection } from "./client";
import type { OutboxTransaction } from "./outbox";
import {
  auditEvents,
  organizationMembers,
  organizations,
  platformRoleAssignments,
  type OrganizationRole,
  type MembershipStatus,
  type OrganizationStatus,
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

export class OrganizationConflictError extends Error {
  constructor(message = "The organization change conflicts with its current state") {
    super(message);
    this.name = "OrganizationConflictError";
  }
}

export class OrganizationNotFoundError extends Error {
  constructor() {
    super("The organization or membership was not found");
    this.name = "OrganizationNotFoundError";
  }
}

async function canManageOrganizationSql(
  transaction: OutboxTransaction,
  actorUserId: string,
  organizationId?: string,
) {
  const [row] = await transaction<{ allowed: boolean }[]>`
    select exists (
      select 1 from platform_role_assignments
      where user_id = ${actorUserId} and role = 'platform_admin'
    ) or (
      ${organizationId ?? null}::uuid is not null and exists (
        select 1 from organization_members
        where organization_id = ${organizationId ?? null}::uuid
          and user_id = ${actorUserId}
          and status = 'active'
          and role in ('owner', 'admin')
      )
    ) as allowed
  `;
  return row?.allowed ?? false;
}

export async function listManagedOrganizations(connection: DatabaseConnection, actor: Actor) {
  return connection.client.begin(async (transaction) => {
    const manageableOrganizations = await transaction<
      {
        administratorCount: number;
        id: string;
        memberCount: number;
        name: string;
        slug: string;
        status: OrganizationStatus;
        updatedAt: Date | string;
      }[]
    >`
      select o.id, o.name, o.slug, o.status, o.updated_at as "updatedAt",
             count(m.id)::int as "memberCount",
             count(m.id) filter (
               where m.status = 'active' and m.role in ('owner', 'admin')
             )::int as "administratorCount"
      from organizations o
      left join organization_members m on m.organization_id = o.id
      where exists (
        select 1 from platform_role_assignments p
        where p.user_id = ${actor.userId} and p.role = 'platform_admin'
      ) or exists (
        select 1 from organization_members own
        where own.organization_id = o.id
          and own.user_id = ${actor.userId}
          and own.status = 'active'
          and own.role in ('owner', 'admin')
      )
      group by o.id
      order by lower(o.name), o.id
    `;
    await transaction`
      insert into audit_events (
        actor_user_id, action, resource_type, outcome, request_id, metadata
      ) values (
        ${actor.userId}, 'organization.list', 'organization', 'success', ${actor.requestId},
        ${JSON.stringify({ count: manageableOrganizations.length })}::jsonb
      )
    `;
    return manageableOrganizations;
  });
}

export async function getOrganizationAdministration(
  connection: DatabaseConnection,
  organizationId: string,
  actor: Actor,
) {
  const result = await connection.client.begin(async (transaction) => {
    if (!(await canManageOrganizationSql(transaction, actor.userId, organizationId))) {
      await transaction`
        insert into audit_events (
          actor_user_id, action, resource_type, resource_id, organization_id,
          outcome, request_id, metadata
        ) values (
          ${actor.userId}, 'organization.read', 'organization', ${organizationId},
          ${organizationId}, 'denied', ${actor.requestId}, '{}'::jsonb
        )
      `;
      return "denied" as const;
    }
    const [organization] = await transaction<
      {
        id: string;
        name: string;
        slug: string;
        status: OrganizationStatus;
        updatedAt: Date | string;
      }[]
    >`
      select id, name, slug, status, updated_at as "updatedAt"
      from organizations where id = ${organizationId}
    `;
    if (!organization) return "not_found" as const;
    const members = await transaction<
      {
        email: string;
        name: string;
        role: OrganizationRole;
        status: MembershipStatus;
        updatedAt: Date | string;
        userId: string;
      }[]
    >`
      select u.id as "userId", u.name, u.email, m.role, m.status,
             m.updated_at as "updatedAt"
      from organization_members m
      join "user" u on u.id = m.user_id
      where m.organization_id = ${organizationId}
      order by case m.role when 'owner' then 1 when 'admin' then 2 else 3 end,
               lower(u.name), u.id
    `;
    const invitations = await transaction<
      {
        email: string;
        expiresAt: Date | string;
        id: string;
        role: OrganizationRole;
      }[]
    >`
      select id, email, role, expires_at as "expiresAt"
      from invitations
      where organization_id = ${organizationId} and status = 'pending'
      order by created_at desc, id
    `;
    await transaction`
      insert into audit_events (
        actor_user_id, action, resource_type, resource_id, organization_id,
        outcome, request_id, metadata
      ) values (
        ${actor.userId}, 'organization.read', 'organization', ${organizationId},
        ${organizationId}, 'success', ${actor.requestId},
        ${JSON.stringify({ invitations: invitations.length, members: members.length })}::jsonb
      )
    `;
    return { invitations, members, organization };
  });
  if (result === "denied") throw new OrganizationAuthorizationError();
  if (result === "not_found") throw new OrganizationNotFoundError();
  return result;
}

export async function updateOrganization(
  connection: DatabaseConnection,
  input: { id: string; name: string; status: OrganizationStatus },
  actor: Actor,
) {
  const result = await connection.client.begin(async (transaction) => {
    const [current] = await transaction<{ id: string }[]>`
      select id from organizations where id = ${input.id} for update
    `;
    if (!current) return "not_found" as const;
    if (!(await canManageOrganizationSql(transaction, actor.userId, input.id))) {
      await transaction`
        insert into audit_events (
          actor_user_id, action, resource_type, resource_id, organization_id,
          outcome, request_id, metadata
        ) values (
          ${actor.userId}, 'organization.update', 'organization', ${input.id}, ${input.id},
          'denied', ${actor.requestId}, '{}'::jsonb
        )
      `;
      return "denied" as const;
    }
    const [organization] = await transaction<
      {
        id: string;
        name: string;
        slug: string;
        status: OrganizationStatus;
        updatedAt: Date | string;
      }[]
    >`
      update organizations
      set name = ${input.name.trim()}, status = ${input.status}, updated_at = now()
      where id = ${input.id}
      returning id, name, slug, status, updated_at as "updatedAt"
    `;
    await transaction`
      insert into audit_events (
        actor_user_id, action, resource_type, resource_id, organization_id,
        outcome, request_id, metadata
      ) values (
        ${actor.userId}, 'organization.update', 'organization', ${input.id}, ${input.id},
        'success', ${actor.requestId}, ${JSON.stringify({ status: input.status })}::jsonb
      )
    `;
    return organization!;
  });
  if (result === "denied") throw new OrganizationAuthorizationError();
  if (result === "not_found") throw new OrganizationNotFoundError();
  return result;
}

export async function updateOrganizationMember(
  connection: DatabaseConnection,
  input: {
    organizationId: string;
    role: OrganizationRole;
    status: MembershipStatus;
    userId: string;
  },
  actor: Actor,
) {
  const result = await connection.client.begin(async (transaction) => {
    const [organization] = await transaction<{ id: string }[]>`
      select id from organizations where id = ${input.organizationId} for update
    `;
    if (!organization) return "not_found" as const;
    if (!(await canManageOrganizationSql(transaction, actor.userId, input.organizationId))) {
      await transaction`
        insert into audit_events (
          actor_user_id, action, resource_type, resource_id, organization_id,
          outcome, request_id, metadata
        ) values (
          ${actor.userId}, 'organization.member.update', 'organization_member', ${input.userId},
          ${input.organizationId}, 'denied', ${actor.requestId}, '{}'::jsonb
        )
      `;
      return "denied" as const;
    }
    const [current] = await transaction<{ role: OrganizationRole; status: MembershipStatus }[]>`
      select role, status from organization_members
      where organization_id = ${input.organizationId} and user_id = ${input.userId}
      for update
    `;
    if (!current) return "not_found" as const;
    const removesAdministrator =
      current.status === "active" &&
      (current.role === "owner" || current.role === "admin") &&
      (input.status !== "active" || input.role === "member");
    if (removesAdministrator) {
      const [count] = await transaction<{ administrators: number }[]>`
        select count(*)::int as administrators from organization_members
        where organization_id = ${input.organizationId}
          and status = 'active' and role in ('owner', 'admin')
      `;
      if ((count?.administrators ?? 0) <= 1) return "last_administrator" as const;
    }
    const [membership] = await transaction<
      {
        role: OrganizationRole;
        status: MembershipStatus;
        updatedAt: Date | string;
        userId: string;
      }[]
    >`
      update organization_members
      set role = ${input.role}, status = ${input.status}, updated_at = now()
      where organization_id = ${input.organizationId} and user_id = ${input.userId}
      returning user_id as "userId", role, status, updated_at as "updatedAt"
    `;
    await transaction`
      insert into audit_events (
        actor_user_id, action, resource_type, resource_id, organization_id,
        outcome, request_id, metadata
      ) values (
        ${actor.userId}, 'organization.member.update', 'organization_member', ${input.userId},
        ${input.organizationId}, 'success', ${actor.requestId},
        ${JSON.stringify({ role: input.role, status: input.status })}::jsonb
      )
    `;
    return membership!;
  });
  if (result === "denied") throw new OrganizationAuthorizationError();
  if (result === "not_found") throw new OrganizationNotFoundError();
  if (result === "last_administrator")
    throw new OrganizationConflictError("The last active administrator must be preserved");
  return result;
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
