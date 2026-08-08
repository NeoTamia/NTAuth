import { and, asc, eq, inArray } from "drizzle-orm";

import {
  parsePolicyDocument,
  PolicyValidationError,
  type PolicyDocument,
} from "@neotamia/permissions";

import type { DatabaseConnection } from "./client";
import {
  auditEvents,
  iamCatalogEntries,
  iamPolicies,
  iamPolicyVersions,
  organizationMembers,
  organizations,
  platformRoleAssignments,
  services,
  type IamPolicyStatus,
} from "./schema";

type Actor = { requestId: string; userId: string };
type Transaction = Parameters<Parameters<DatabaseConnection["db"]["transaction"]>[0]>[0];

export class IamPolicyAuthorizationError extends Error {
  constructor() {
    super("IAM policy operation is not permitted");
    this.name = "IamPolicyAuthorizationError";
  }
}

export class IamPolicyConflictError extends Error {
  constructor() {
    super("IAM policy version conflicts with current state");
    this.name = "IamPolicyConflictError";
  }
}

export class IamPolicyNotFoundError extends Error {
  constructor() {
    super("IAM policy not found");
    this.name = "IamPolicyNotFoundError";
  }
}

export { PolicyValidationError as IamPolicyValidationError };

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function hashPolicyDocument(document: PolicyDocument) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(document)),
  );
  return Buffer.from(digest).toString("hex");
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

async function validatedDocument(transaction: Transaction, service: string, input: unknown) {
  const [registered] = await transaction
    .select({ key: services.key })
    .from(services)
    .where(and(eq(services.key, service), eq(services.status, "active")))
    .limit(1);
  if (!registered) throw new IamPolicyNotFoundError();
  const entries = await transaction
    .select({ identifier: iamCatalogEntries.identifier, kind: iamCatalogEntries.kind })
    .from(iamCatalogEntries)
    .where(and(eq(iamCatalogEntries.service, service), eq(iamCatalogEntries.status, "active")));
  return parsePolicyDocument(input, {
    actions: new Set(
      entries.filter((entry) => entry.kind === "action").map((entry) => entry.identifier),
    ),
    expectedService: service,
    resources: new Set(
      entries.filter((entry) => entry.kind === "resource").map((entry) => entry.identifier),
    ),
  });
}

async function audit(
  transaction: Transaction,
  input: {
    action: string;
    actor: Actor;
    organizationId: string;
    outcome: "denied" | "success";
    policyId?: string;
    service: string;
    version?: number;
  },
) {
  await transaction.insert(auditEvents).values({
    action: input.action,
    actorUserId: input.actor.userId,
    metadata: { service: input.service, version: input.version ?? null },
    organizationId: input.organizationId,
    outcome: input.outcome,
    requestId: input.actor.requestId,
    resourceId: input.policyId,
    resourceType: "iam_policy",
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

export async function createIamPolicy(
  connection: DatabaseConnection,
  input: { document: unknown; name: string; organizationId: string; service: string },
  actor: Actor,
) {
  if (input.name.trim().length === 0 || input.name.length > 160) {
    throw new IamPolicyConflictError();
  }
  try {
    const result = await connection.db.transaction(async (transaction) => {
      if (!(await canManage(transaction, actor.userId, input.organizationId))) {
        await audit(transaction, {
          action: "iam.policy.create",
          actor,
          organizationId: input.organizationId,
          outcome: "denied",
          service: input.service,
        });
        return { kind: "denied" as const };
      }
      const document = await validatedDocument(transaction, input.service, input.document);
      const [policy] = await transaction
        .insert(iamPolicies)
        .values({
          createdByUserId: actor.userId,
          name: input.name.trim(),
          organizationId: input.organizationId,
          service: input.service,
        })
        .returning();
      const [version] = await transaction
        .insert(iamPolicyVersions)
        .values({
          createdByUserId: actor.userId,
          document,
          documentHash: await hashPolicyDocument(document),
          policyId: policy!.id,
          version: 1,
        })
        .returning();
      await audit(transaction, {
        action: "iam.policy.create",
        actor,
        organizationId: input.organizationId,
        outcome: "success",
        policyId: policy!.id,
        service: input.service,
        version: 1,
      });
      return { kind: "success" as const, policy: policy!, version: version! };
    });
    if (result.kind === "denied") throw new IamPolicyAuthorizationError();
    return { policy: result.policy, version: result.version };
  } catch (error) {
    if (isUniqueViolation(error)) throw new IamPolicyConflictError();
    throw error;
  }
}

async function lockedPolicy(transaction: Transaction, policyId: string) {
  const [policy] = await transaction
    .select()
    .from(iamPolicies)
    .where(eq(iamPolicies.id, policyId))
    .for("update")
    .limit(1);
  return policy;
}

async function appendVersion(
  transaction: Transaction,
  input: {
    actor: Actor;
    document: PolicyDocument;
    expectedVersion: number;
    policy: typeof iamPolicies.$inferSelect;
    sourceVersion?: number;
  },
) {
  if (input.expectedVersion !== input.policy.currentVersion) throw new IamPolicyConflictError();
  const versionNumber = input.policy.currentVersion + 1;
  const [version] = await transaction
    .insert(iamPolicyVersions)
    .values({
      createdByUserId: input.actor.userId,
      document: input.document,
      documentHash: await hashPolicyDocument(input.document),
      policyId: input.policy.id,
      sourceVersion: input.sourceVersion,
      version: versionNumber,
    })
    .returning();
  const [policy] = await transaction
    .update(iamPolicies)
    .set({ currentVersion: versionNumber, updatedAt: new Date() })
    .where(eq(iamPolicies.id, input.policy.id))
    .returning();
  return { policy: policy!, version: version! };
}

export async function createIamPolicyVersion(
  connection: DatabaseConnection,
  input: { document: unknown; expectedVersion: number; policyId: string },
  actor: Actor,
) {
  const result = await connection.db.transaction(async (transaction) => {
    const policy = await lockedPolicy(transaction, input.policyId);
    if (!policy) throw new IamPolicyNotFoundError();
    if (!(await canManage(transaction, actor.userId, policy.organizationId))) {
      await audit(transaction, {
        action: "iam.policy.version.create",
        actor,
        organizationId: policy.organizationId,
        outcome: "denied",
        policyId: policy.id,
        service: policy.service,
      });
      return { kind: "denied" as const };
    }
    const document = await validatedDocument(transaction, policy.service, input.document);
    const version = await appendVersion(transaction, { ...input, actor, document, policy });
    await audit(transaction, {
      action: "iam.policy.version.create",
      actor,
      organizationId: policy.organizationId,
      outcome: "success",
      policyId: policy.id,
      service: policy.service,
      version: version.version.version,
    });
    return { kind: "success" as const, ...version };
  });
  if (result.kind === "denied") throw new IamPolicyAuthorizationError();
  return { policy: result.policy, version: result.version };
}

export async function rollbackIamPolicy(
  connection: DatabaseConnection,
  input: { expectedVersion: number; policyId: string; targetVersion: number },
  actor: Actor,
) {
  const result = await connection.db.transaction(async (transaction) => {
    const policy = await lockedPolicy(transaction, input.policyId);
    if (!policy) throw new IamPolicyNotFoundError();
    if (!(await canManage(transaction, actor.userId, policy.organizationId))) {
      await audit(transaction, {
        action: "iam.policy.rollback",
        actor,
        organizationId: policy.organizationId,
        outcome: "denied",
        policyId: policy.id,
        service: policy.service,
      });
      return { kind: "denied" as const };
    }
    const [target] = await transaction
      .select()
      .from(iamPolicyVersions)
      .where(
        and(
          eq(iamPolicyVersions.policyId, policy.id),
          eq(iamPolicyVersions.version, input.targetVersion),
        ),
      )
      .limit(1);
    if (!target) throw new IamPolicyNotFoundError();
    const version = await appendVersion(transaction, {
      actor,
      document: target.document,
      expectedVersion: input.expectedVersion,
      policy,
      sourceVersion: target.version,
    });
    await audit(transaction, {
      action: "iam.policy.rollback",
      actor,
      organizationId: policy.organizationId,
      outcome: "success",
      policyId: policy.id,
      service: policy.service,
      version: version.version.version,
    });
    return { kind: "success" as const, ...version };
  });
  if (result.kind === "denied") throw new IamPolicyAuthorizationError();
  return { policy: result.policy, version: result.version };
}

export async function setIamPolicyStatus(
  connection: DatabaseConnection,
  input: { policyId: string; status: IamPolicyStatus },
  actor: Actor,
) {
  const result = await connection.db.transaction(async (transaction) => {
    const policy = await lockedPolicy(transaction, input.policyId);
    if (!policy) return { kind: "missing" as const };
    if (!(await canManage(transaction, actor.userId, policy.organizationId))) {
      await audit(transaction, {
        action: "iam.policy.status.change",
        actor,
        organizationId: policy.organizationId,
        outcome: "denied",
        policyId: policy.id,
        service: policy.service,
      });
      return { kind: "denied" as const };
    }
    const [updated] = await transaction
      .update(iamPolicies)
      .set({ status: input.status, updatedAt: new Date() })
      .where(eq(iamPolicies.id, policy.id))
      .returning();
    await audit(transaction, {
      action: "iam.policy.status.change",
      actor,
      organizationId: policy.organizationId,
      outcome: "success",
      policyId: policy.id,
      service: policy.service,
      version: policy.currentVersion,
    });
    return { kind: "success" as const, policy: updated! };
  });
  if (result.kind === "missing") throw new IamPolicyNotFoundError();
  if (result.kind === "denied") throw new IamPolicyAuthorizationError();
  return result.policy;
}

export async function getIamPolicyHistory(
  connection: DatabaseConnection,
  policyId: string,
  actor: Actor,
) {
  const [policy] = await connection.db
    .select()
    .from(iamPolicies)
    .where(eq(iamPolicies.id, policyId))
    .limit(1);
  if (!policy) throw new IamPolicyNotFoundError();
  if (
    !(await connection.db.transaction((transaction) =>
      canManage(transaction, actor.userId, policy.organizationId),
    ))
  ) {
    throw new IamPolicyAuthorizationError();
  }
  const versions = await connection.db
    .select()
    .from(iamPolicyVersions)
    .where(eq(iamPolicyVersions.policyId, policyId))
    .orderBy(asc(iamPolicyVersions.version));
  return { policy, versions };
}
