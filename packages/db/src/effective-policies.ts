import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";

import type { PolicyDocument } from "@neotamia/permissions";

import type { DatabaseConnection } from "./client";
import {
  iamGroupMembers,
  iamGroups,
  iamPolicies,
  iamPolicyAttachments,
  iamPolicyVersions,
  organizationMembers,
  organizations,
  serviceGrants,
  services,
  user,
  type OrganizationRole,
} from "./schema";

export class EffectivePolicyAuthorizationError extends Error {
  constructor() {
    super("Effective policies are not available for this subject and organization");
    this.name = "EffectivePolicyAuthorizationError";
  }
}

export class EffectivePolicyNotFoundError extends Error {
  constructor() {
    super("Effective policy service not found");
    this.name = "EffectivePolicyNotFoundError";
  }
}

export type EffectivePolicyRow = {
  document: PolicyDocument;
  documentHash: string;
  policyId: string;
  policyName: string;
  version: number;
};

export function mergeEffectivePolicies(rows: EffectivePolicyRow[]) {
  const byPolicy = new Map<string, EffectivePolicyRow>();
  for (const row of rows) byPolicy.set(row.policyId, row);
  const policies = [...byPolicy.values()].toSorted(
    (left, right) =>
      left.policyName.localeCompare(right.policyName) ||
      left.policyId.localeCompare(right.policyId),
  );
  return {
    policies: policies.map(({ document, documentHash, policyId, policyName, version }) => ({
      documentHash,
      id: policyId,
      name: policyName,
      version,
      statements: document.statements,
    })),
    statements: policies.flatMap(({ document }) => document.statements),
  };
}

async function activeMembership(
  connection: DatabaseConnection,
  organizationId: string,
  userId: string,
) {
  const [membership] = await connection.db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, organizationMembers.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .innerJoin(user, and(eq(user.id, organizationMembers.userId), eq(user.status, "active")))
    .where(
      and(
        eq(organizationMembers.organizationId, organizationId),
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.status, "active"),
      ),
    )
    .limit(1);
  return membership;
}

async function hasGrant(
  connection: DatabaseConnection,
  input: { organizationId: string; service: string; userId: string },
) {
  const [grant] = await connection.db
    .select({ id: serviceGrants.id })
    .from(serviceGrants)
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

async function activeGroupIds(
  connection: DatabaseConnection,
  organizationId: string,
  userId: string,
) {
  const groups = await connection.db
    .select({ id: iamGroups.id })
    .from(iamGroupMembers)
    .innerJoin(iamGroups, eq(iamGroups.id, iamGroupMembers.groupId))
    .where(and(eq(iamGroupMembers.userId, userId), eq(iamGroups.organizationId, organizationId)))
    .orderBy(asc(iamGroups.id));
  return groups.map(({ id }) => id);
}

function attachmentFilter(userId: string, role: OrganizationRole, groupIds: string[]) {
  const filters = [
    and(
      eq(iamPolicyAttachments.principalType, "user"),
      eq(iamPolicyAttachments.principalId, userId),
    ),
    and(eq(iamPolicyAttachments.principalType, "role"), eq(iamPolicyAttachments.principalId, role)),
  ];
  if (groupIds.length > 0) {
    filters.push(
      and(
        eq(iamPolicyAttachments.principalType, "group"),
        inArray(iamPolicyAttachments.principalId, groupIds),
      ),
    );
  }
  return or(...filters);
}

export async function getEffectivePolicies(
  connection: DatabaseConnection,
  input: { organizationId: string; service: string; userId: string },
) {
  const membership = await activeMembership(connection, input.organizationId, input.userId);
  if (!membership) throw new EffectivePolicyAuthorizationError();
  const [service] = await connection.db
    .select({ key: services.key })
    .from(services)
    .where(and(eq(services.key, input.service), eq(services.status, "active")))
    .limit(1);
  if (!service) throw new EffectivePolicyNotFoundError();
  if (!(await hasGrant(connection, input))) {
    return {
      organizationId: input.organizationId,
      policies: [],
      service: input.service,
      statements: [],
      subjectUserId: input.userId,
    };
  }

  const groupIds = await activeGroupIds(connection, input.organizationId, input.userId);
  const rows = await connection.db
    .select({
      document: iamPolicyVersions.document,
      documentHash: iamPolicyVersions.documentHash,
      policyId: iamPolicies.id,
      policyName: iamPolicies.name,
      version: iamPolicyVersions.version,
    })
    .from(iamPolicyAttachments)
    .innerJoin(
      iamPolicies,
      and(
        eq(iamPolicies.id, iamPolicyAttachments.policyId),
        eq(iamPolicies.organizationId, input.organizationId),
        eq(iamPolicies.service, input.service),
        eq(iamPolicies.status, "active"),
      ),
    )
    .innerJoin(
      iamPolicyVersions,
      and(
        eq(iamPolicyVersions.policyId, iamPolicies.id),
        eq(iamPolicyVersions.version, iamPolicies.currentVersion),
      ),
    )
    .where(
      and(
        isNull(iamPolicyAttachments.detachedAt),
        attachmentFilter(input.userId, membership.role, groupIds),
      ),
    );
  return {
    organizationId: input.organizationId,
    ...mergeEffectivePolicies(rows),
    service: input.service,
    subjectUserId: input.userId,
  };
}
