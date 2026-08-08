import { and, eq, inArray, isNull } from "drizzle-orm";

import type { DatabaseConnection } from "./client";
import {
  auditEvents,
  iamGroupMembers,
  iamGroups,
  iamPolicies,
  iamPolicyAttachments,
  organizationMembers,
  organizations,
  platformRoleAssignments,
  services,
  user,
  type IamPrincipalType,
  type OrganizationRole,
} from "./schema";

type Actor = { requestId: string; userId: string };
type Transaction = Parameters<Parameters<DatabaseConnection["db"]["transaction"]>[0]>[0];

export class IamAttachmentAuthorizationError extends Error {
  constructor() {
    super("IAM attachment operation is not permitted");
    this.name = "IamAttachmentAuthorizationError";
  }
}

export class IamAttachmentConflictError extends Error {
  constructor() {
    super("IAM attachment conflicts with current state");
    this.name = "IamAttachmentConflictError";
  }
}

export class IamAttachmentNotFoundError extends Error {
  constructor() {
    super("IAM attachment resource not found");
    this.name = "IamAttachmentNotFoundError";
  }
}

async function canManage(transaction: Transaction, actorUserId: string, organizationId: string) {
  const [platform] = await transaction
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

async function audit(
  transaction: Transaction,
  input: {
    action: string;
    actor: Actor;
    attachmentId?: string;
    groupId?: string;
    idempotent?: boolean;
    organizationId: string;
    outcome: "denied" | "success";
    policyId?: string;
    principalId?: string;
    principalType?: IamPrincipalType;
    service?: string;
  },
) {
  await transaction.insert(auditEvents).values({
    action: input.action,
    actorUserId: input.actor.userId,
    metadata: {
      groupId: input.groupId ?? null,
      idempotent: input.idempotent ?? false,
      policyId: input.policyId ?? null,
      principalId: input.principalId ?? null,
      principalType: input.principalType ?? null,
      service: input.service ?? null,
    },
    organizationId: input.organizationId,
    outcome: input.outcome,
    requestId: input.actor.requestId,
    resourceId: input.attachmentId ?? input.groupId,
    resourceType: input.attachmentId ? "iam_policy_attachment" : "iam_group",
  });
}

function isUniqueViolation(error: unknown) {
  let current = error;
  while (current && typeof current === "object") {
    if ("code" in current && (current as { code?: unknown }).code === "23505") return true;
    current = "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

async function loadGroup(transaction: Transaction, groupId: string) {
  const [group] = await transaction
    .select()
    .from(iamGroups)
    .where(eq(iamGroups.id, groupId))
    .limit(1);
  return group;
}

export async function createIamGroup(
  connection: DatabaseConnection,
  input: { name: string; organizationId: string },
  actor: Actor,
) {
  if (input.name.trim().length === 0 || input.name.length > 160)
    throw new IamAttachmentConflictError();
  try {
    const result = await connection.db.transaction(async (transaction) => {
      if (!(await canManage(transaction, actor.userId, input.organizationId))) {
        await audit(transaction, {
          action: "iam.group.create",
          actor,
          organizationId: input.organizationId,
          outcome: "denied",
        });
        return { kind: "denied" as const };
      }
      const [group] = await transaction
        .insert(iamGroups)
        .values({
          createdByUserId: actor.userId,
          name: input.name.trim(),
          organizationId: input.organizationId,
        })
        .returning();
      await audit(transaction, {
        action: "iam.group.create",
        actor,
        groupId: group!.id,
        organizationId: input.organizationId,
        outcome: "success",
      });
      return { group: group!, kind: "success" as const };
    });
    if (result.kind === "denied") throw new IamAttachmentAuthorizationError();
    return result.group;
  } catch (error) {
    if (isUniqueViolation(error)) throw new IamAttachmentConflictError();
    throw error;
  }
}

async function validOrganizationUser(
  transaction: Transaction,
  organizationId: string,
  userId: string,
) {
  const [membership] = await transaction
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .innerJoin(user, and(eq(user.id, organizationMembers.userId), eq(user.status, "active")))
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

export async function addIamGroupMember(
  connection: DatabaseConnection,
  input: { groupId: string; userId: string },
  actor: Actor,
) {
  try {
    const result = await connection.db.transaction(async (transaction) => {
      const group = await loadGroup(transaction, input.groupId);
      if (!group) return { kind: "missing" as const };
      if (
        !(await canManage(transaction, actor.userId, group.organizationId)) ||
        !(await validOrganizationUser(transaction, group.organizationId, input.userId))
      ) {
        await audit(transaction, {
          action: "iam.group.member.add",
          actor,
          groupId: group.id,
          organizationId: group.organizationId,
          outcome: "denied",
          principalId: input.userId,
          principalType: "user",
        });
        return { kind: "denied" as const };
      }
      const [membership] = await transaction
        .insert(iamGroupMembers)
        .values({ addedByUserId: actor.userId, groupId: group.id, userId: input.userId })
        .returning();
      await audit(transaction, {
        action: "iam.group.member.add",
        actor,
        groupId: group.id,
        organizationId: group.organizationId,
        outcome: "success",
        principalId: input.userId,
        principalType: "user",
      });
      return { kind: "success" as const, membership: membership! };
    });
    if (result.kind === "missing") throw new IamAttachmentNotFoundError();
    if (result.kind === "denied") throw new IamAttachmentAuthorizationError();
    return result.membership;
  } catch (error) {
    if (isUniqueViolation(error)) throw new IamAttachmentConflictError();
    throw error;
  }
}

async function loadPolicyScope(transaction: Transaction, policyId: string) {
  const [policy] = await transaction
    .select({
      id: iamPolicies.id,
      organizationId: iamPolicies.organizationId,
      service: iamPolicies.service,
    })
    .from(iamPolicies)
    .innerJoin(organizations, eq(organizations.id, iamPolicies.organizationId))
    .innerJoin(services, eq(services.key, iamPolicies.service))
    .where(
      and(
        eq(iamPolicies.id, policyId),
        eq(organizations.status, "active"),
        eq(services.status, "active"),
      ),
    )
    .limit(1);
  return policy;
}

async function validPrincipal(
  transaction: Transaction,
  policy: { organizationId: string },
  type: IamPrincipalType,
  id: string,
) {
  if (type === "role") return ["owner", "admin", "member"].includes(id);
  if (type === "user") return validOrganizationUser(transaction, policy.organizationId, id);
  const group = await loadGroup(transaction, id);
  return group?.organizationId === policy.organizationId;
}

export async function attachIamPolicy(
  connection: DatabaseConnection,
  input: { policyId: string; principalId: string; principalType: IamPrincipalType },
  actor: Actor,
) {
  try {
    const result = await connection.db.transaction(async (transaction) => {
      const policy = await loadPolicyScope(transaction, input.policyId);
      if (!policy) return { kind: "missing" as const };
      if (
        !(await canManage(transaction, actor.userId, policy.organizationId)) ||
        !(await validPrincipal(transaction, policy, input.principalType, input.principalId))
      ) {
        await audit(transaction, {
          action: "iam.policy.attach",
          actor,
          organizationId: policy.organizationId,
          outcome: "denied",
          policyId: policy.id,
          principalId: input.principalId,
          principalType: input.principalType,
          service: policy.service,
        });
        return { kind: "denied" as const };
      }
      const [attachment] = await transaction
        .insert(iamPolicyAttachments)
        .values({
          createdByUserId: actor.userId,
          policyId: policy.id,
          principalId: input.principalId,
          principalType: input.principalType,
        })
        .returning();
      await audit(transaction, {
        action: "iam.policy.attach",
        actor,
        attachmentId: attachment!.id,
        organizationId: policy.organizationId,
        outcome: "success",
        policyId: policy.id,
        principalId: input.principalId,
        principalType: input.principalType,
        service: policy.service,
      });
      return { attachment: attachment!, kind: "success" as const };
    });
    if (result.kind === "missing") throw new IamAttachmentNotFoundError();
    if (result.kind === "denied") throw new IamAttachmentAuthorizationError();
    return result.attachment;
  } catch (error) {
    if (isUniqueViolation(error)) throw new IamAttachmentConflictError();
    throw error;
  }
}

export async function detachIamPolicy(
  connection: DatabaseConnection,
  attachmentId: string,
  actor: Actor,
) {
  const result = await connection.db.transaction(async (transaction) => {
    const [current] = await transaction
      .select({ attachment: iamPolicyAttachments, policy: iamPolicies })
      .from(iamPolicyAttachments)
      .innerJoin(iamPolicies, eq(iamPolicies.id, iamPolicyAttachments.policyId))
      .where(eq(iamPolicyAttachments.id, attachmentId))
      .for("update")
      .limit(1);
    if (!current) return { kind: "missing" as const };
    if (!(await canManage(transaction, actor.userId, current.policy.organizationId))) {
      await audit(transaction, {
        action: "iam.policy.detach",
        actor,
        attachmentId,
        organizationId: current.policy.organizationId,
        outcome: "denied",
        policyId: current.policy.id,
        principalId: current.attachment.principalId,
        principalType: current.attachment.principalType,
        service: current.policy.service,
      });
      return { kind: "denied" as const };
    }
    if (current.attachment.detachedAt) {
      await audit(transaction, {
        action: "iam.policy.detach",
        actor,
        attachmentId,
        idempotent: true,
        organizationId: current.policy.organizationId,
        outcome: "success",
        policyId: current.policy.id,
        principalId: current.attachment.principalId,
        principalType: current.attachment.principalType,
        service: current.policy.service,
      });
      return { attachment: current.attachment, kind: "success" as const };
    }
    const [attachment] = await transaction
      .update(iamPolicyAttachments)
      .set({ detachedAt: new Date(), detachedByUserId: actor.userId })
      .where(eq(iamPolicyAttachments.id, attachmentId))
      .returning();
    await audit(transaction, {
      action: "iam.policy.detach",
      actor,
      attachmentId,
      organizationId: current.policy.organizationId,
      outcome: "success",
      policyId: current.policy.id,
      principalId: current.attachment.principalId,
      principalType: current.attachment.principalType,
      service: current.policy.service,
    });
    return { attachment: attachment!, kind: "success" as const };
  });
  if (result.kind === "missing") throw new IamAttachmentNotFoundError();
  if (result.kind === "denied") throw new IamAttachmentAuthorizationError();
  return result.attachment;
}

export async function listIamPolicyAttachments(
  connection: DatabaseConnection,
  policyId: string,
  actor: Actor,
) {
  const result = await connection.db.transaction(async (transaction) => {
    const policy = await loadPolicyScope(transaction, policyId);
    if (!policy) return { kind: "missing" as const };
    if (!(await canManage(transaction, actor.userId, policy.organizationId)))
      return { kind: "denied" as const };
    const attachments = await transaction
      .select()
      .from(iamPolicyAttachments)
      .where(
        and(eq(iamPolicyAttachments.policyId, policy.id), isNull(iamPolicyAttachments.detachedAt)),
      );
    return { attachments, kind: "success" as const };
  });
  if (result.kind === "missing") throw new IamAttachmentNotFoundError();
  if (result.kind === "denied") throw new IamAttachmentAuthorizationError();
  return result.attachments;
}

export function isOrganizationRole(value: string): value is OrganizationRole {
  return ["owner", "admin", "member"].includes(value);
}
