import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import {
  addIamGroupMember,
  attachIamPolicy,
  createIamGroup,
  detachIamPolicy,
  IamAttachmentAuthorizationError,
  IamAttachmentConflictError,
  listIamPolicyAttachments,
} from "./iam-attachments";
import { createDatabase, type DatabaseConnection } from "./client";
import { deleteAuditEventsForTest } from "./test-support";
import { createIamPolicy } from "./iam-policies";
import { applyMigrations } from "./migrations";
import {
  auditEvents,
  iamCatalogEntries,
  organizationMembers,
  organizations,
  services,
  user,
} from "./schema";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("IAM policy attachments", () => {
  let connection: DatabaseConnection;
  const runId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const outsiderId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const otherOrganizationId = crypto.randomUUID();
  const service = `attachment-${runId}`;
  const action = `${service}:report:read`;
  const resource = `${service}:report:*`;
  const actor = (userId: string, suffix: string) => ({
    requestId: `${runId}-${suffix}`,
    userId,
  });
  const document = {
    statements: [{ actions: [action], effect: "Allow" as const, resources: [resource] }],
    version: "2026-01-01" as const,
  };

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 4 });
    await applyMigrations(connection);
    await connection.db.insert(user).values(
      [ownerId, memberId, outsiderId].map((id, index) => ({
        email: `attachment-${index}-${runId}@example.test`,
        emailVerified: true,
        id,
        name: `Attachment user ${index}`,
      })),
    );
    await connection.db.insert(organizations).values([
      { id: organizationId, name: "Attachment organization", slug: `attachment-${runId}` },
      { id: otherOrganizationId, name: "Other organization", slug: `other-attachment-${runId}` },
    ]);
    await connection.db.insert(organizationMembers).values([
      { organizationId, role: "owner", userId: ownerId },
      { organizationId, role: "member", userId: memberId },
      { organizationId: otherOrganizationId, role: "owner", userId: outsiderId },
    ]);
    await connection.db.insert(services).values({
      key: service,
      name: "Attachment service",
      ownerUserId: ownerId,
    });
    await connection.db.insert(iamCatalogEntries).values([
      { createdByUserId: ownerId, identifier: action, kind: "action", service },
      { createdByUserId: ownerId, identifier: resource, kind: "resource", service },
    ]);
  });

  afterAll(async () => {
    await deleteAuditEventsForTest(connection, { requestIdPrefixes: [`${runId}-`] });
    await connection.db.delete(organizations).where(eq(organizations.id, organizationId));
    await connection.db.delete(organizations).where(eq(organizations.id, otherOrganizationId));
    await connection.db.delete(services).where(eq(services.key, service));
    await connection.db.delete(user).where(eq(user.id, ownerId));
    await connection.db.delete(user).where(eq(user.id, memberId));
    await connection.db.delete(user).where(eq(user.id, outsiderId));
    await connection.close();
  });

  test("attaches user, group and role principals in one policy scope", async () => {
    const policy = await createIamPolicy(
      connection,
      { document, name: "All principal types", organizationId, service },
      actor(ownerId, "policy-create"),
    );
    const group = await createIamGroup(
      connection,
      { name: "Auditors", organizationId },
      actor(ownerId, "group-create"),
    );
    await expect(
      addIamGroupMember(
        connection,
        { groupId: group.id, userId: memberId },
        actor(ownerId, "group-member"),
      ),
    ).resolves.toMatchObject({ groupId: group.id, userId: memberId });

    const userAttachment = await attachIamPolicy(
      connection,
      { policyId: policy.policy.id, principalId: memberId, principalType: "user" },
      actor(ownerId, "attach-user"),
    );
    await attachIamPolicy(
      connection,
      { policyId: policy.policy.id, principalId: group.id, principalType: "group" },
      actor(ownerId, "attach-group"),
    );
    await attachIamPolicy(
      connection,
      { policyId: policy.policy.id, principalId: "member", principalType: "role" },
      actor(ownerId, "attach-role"),
    );
    expect(
      (
        await listIamPolicyAttachments(
          connection,
          policy.policy.id,
          actor(ownerId, "attachment-list"),
        )
      )
        .map(({ principalType }) => principalType)
        .toSorted(),
    ).toEqual(["group", "role", "user"]);

    const detached = await detachIamPolicy(
      connection,
      userAttachment.id,
      actor(ownerId, "detach-user"),
    );
    expect(detached.detachedAt).toBeInstanceOf(Date);
    await expect(
      detachIamPolicy(connection, userAttachment.id, actor(ownerId, "detach-user-again")),
    ).resolves.toMatchObject({ id: userAttachment.id });
    const replacement = await attachIamPolicy(
      connection,
      { policyId: policy.policy.id, principalId: memberId, principalType: "user" },
      actor(ownerId, "reattach-user"),
    );
    expect(replacement.id).not.toBe(userAttachment.id);
  });

  test("prevents duplicate attachments under concurrency", async () => {
    const policy = await createIamPolicy(
      connection,
      { document, name: "Concurrent attachment", organizationId, service },
      actor(ownerId, "concurrent-policy"),
    );
    const results = await Promise.allSettled([
      attachIamPolicy(
        connection,
        { policyId: policy.policy.id, principalId: "admin", principalType: "role" },
        actor(ownerId, "concurrent-a"),
      ),
      attachIamPolicy(
        connection,
        { policyId: policy.policy.id, principalId: "admin", principalType: "role" },
        actor(ownerId, "concurrent-b"),
      ),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toBeInstanceOf(IamAttachmentConflictError);
  });

  test("fails closed for invalid and cross-tenant principals", async () => {
    const policy = await createIamPolicy(
      connection,
      { document, name: "Fail closed attachment", organizationId, service },
      actor(ownerId, "closed-policy"),
    );
    await expect(
      attachIamPolicy(
        connection,
        { policyId: policy.policy.id, principalId: outsiderId, principalType: "user" },
        actor(ownerId, "cross-tenant-user"),
      ),
    ).rejects.toBeInstanceOf(IamAttachmentAuthorizationError);
    await expect(
      attachIamPolicy(
        connection,
        { policyId: policy.policy.id, principalId: "super-admin", principalType: "role" },
        actor(ownerId, "invalid-role"),
      ),
    ).rejects.toBeInstanceOf(IamAttachmentAuthorizationError);
    await expect(
      attachIamPolicy(
        connection,
        { policyId: policy.policy.id, principalId: memberId, principalType: "user" },
        actor(outsiderId, "cross-tenant-actor"),
      ),
    ).rejects.toBeInstanceOf(IamAttachmentAuthorizationError);

    const denied = await connection.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.outcome, "denied"));
    expect(
      denied
        .filter(({ requestId }) => requestId.startsWith(runId))
        .map(({ requestId }) => requestId),
    ).toEqual(
      expect.arrayContaining([
        `${runId}-cross-tenant-user`,
        `${runId}-invalid-role`,
        `${runId}-cross-tenant-actor`,
      ]),
    );
  });
});
