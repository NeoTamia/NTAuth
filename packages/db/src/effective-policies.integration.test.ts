import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import {
  addIamGroupMember,
  attachIamPolicy,
  createIamGroup,
  detachIamPolicy,
} from "./iam-attachments";
import { createDatabase, type DatabaseConnection } from "./client";
import { EffectivePolicyAuthorizationError, getEffectivePolicies } from "./effective-policies";
import { createIamPolicy, setIamPolicyStatus } from "./iam-policies";
import { applyMigrations } from "./migrations";
import { createServiceGrant, setServiceGrantActive } from "./service-grants";
import { iamCatalogEntries, organizationMembers, organizations, services, user } from "./schema";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("effective IAM policies", () => {
  let connection: DatabaseConnection;
  const runId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const noGrantId = crypto.randomUUID();
  const outsiderId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const otherOrganizationId = crypto.randomUUID();
  const service = `effective-${runId}`;
  const action = `${service}:report:read`;
  const resource = `${service}:report:*`;
  const actor = (suffix: string) => ({ requestId: `${runId}-${suffix}`, userId: ownerId });
  const document = (effect: "Allow" | "Deny") => ({
    statements: [{ actions: [action], effect, resources: [resource] }],
    version: "2026-01-01" as const,
  });

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 4 });
    await applyMigrations(connection);
    await connection.db.insert(user).values(
      [ownerId, memberId, noGrantId, outsiderId].map((id, index) => ({
        email: `effective-${index}-${runId}@example.test`,
        emailVerified: true,
        id,
        name: `Effective user ${index}`,
      })),
    );
    await connection.db.insert(organizations).values([
      { id: organizationId, name: "Effective organization", slug: `effective-${runId}` },
      { id: otherOrganizationId, name: "Other organization", slug: `other-effective-${runId}` },
    ]);
    await connection.db.insert(organizationMembers).values([
      { organizationId, role: "owner", userId: ownerId },
      { organizationId, role: "member", userId: memberId },
      { organizationId, role: "member", userId: noGrantId },
      { organizationId: otherOrganizationId, role: "owner", userId: outsiderId },
    ]);
    await connection.db.insert(services).values({
      key: service,
      name: "Effective policy service",
      ownerUserId: ownerId,
    });
    await connection.db.insert(iamCatalogEntries).values([
      { createdByUserId: ownerId, identifier: action, kind: "action", service },
      { createdByUserId: ownerId, identifier: resource, kind: "resource", service },
    ]);
  });

  afterAll(async () => {
    await connection.client`delete from audit_events where request_id like ${`${runId}-%`}`;
    await connection.db.delete(organizations).where(eq(organizations.id, organizationId));
    await connection.db.delete(organizations).where(eq(organizations.id, otherOrganizationId));
    await connection.db.delete(services).where(eq(services.key, service));
    await Promise.all(
      [ownerId, memberId, noGrantId, outsiderId].map((id) =>
        connection.db.delete(user).where(eq(user.id, id)),
      ),
    );
    await connection.close();
  });

  test("merges direct, group and role attachments deterministically", async () => {
    const grant = await createServiceGrant(
      connection,
      { organizationId, service, userId: memberId },
      actor("grant"),
    );
    const alpha = await createIamPolicy(
      connection,
      { document: document("Deny"), name: "Alpha", organizationId, service },
      actor("alpha"),
    );
    const middle = await createIamPolicy(
      connection,
      { document: document("Allow"), name: "Middle", organizationId, service },
      actor("middle"),
    );
    const zulu = await createIamPolicy(
      connection,
      { document: document("Allow"), name: "Zulu", organizationId, service },
      actor("zulu"),
    );
    const inactive = await createIamPolicy(
      connection,
      { document: document("Allow"), name: "Inactive", organizationId, service },
      actor("inactive"),
    );
    await setIamPolicyStatus(
      connection,
      { policyId: inactive.policy.id, status: "inactive" },
      actor("inactive-status"),
    );
    const group = await createIamGroup(
      connection,
      { name: "Readers", organizationId },
      actor("group"),
    );
    await addIamGroupMember(connection, { groupId: group.id, userId: memberId }, actor("member"));
    await attachIamPolicy(
      connection,
      { policyId: zulu.policy.id, principalId: memberId, principalType: "user" },
      actor("direct"),
    );
    await attachIamPolicy(
      connection,
      { policyId: alpha.policy.id, principalId: group.id, principalType: "group" },
      actor("group-attachment"),
    );
    await attachIamPolicy(
      connection,
      { policyId: middle.policy.id, principalId: "member", principalType: "role" },
      actor("role"),
    );
    await attachIamPolicy(
      connection,
      { policyId: alpha.policy.id, principalId: "member", principalType: "role" },
      actor("alpha-duplicate-path"),
    );
    await attachIamPolicy(
      connection,
      { policyId: inactive.policy.id, principalId: memberId, principalType: "user" },
      actor("inactive-attachment"),
    );
    const detached = await attachIamPolicy(
      connection,
      { policyId: zulu.policy.id, principalId: group.id, principalType: "group" },
      actor("detached-attachment"),
    );
    await detachIamPolicy(connection, detached.id, actor("detach"));

    const effective = await getEffectivePolicies(connection, {
      organizationId,
      service,
      userId: memberId,
    });
    expect(effective.policies.map(({ name }) => name)).toEqual(["Alpha", "Middle", "Zulu"]);
    expect(effective.statements.map(({ effect }) => effect)).toEqual(["Deny", "Allow", "Allow"]);

    await setServiceGrantActive(connection, { active: false, grantId: grant.id }, actor("disable"));
    await expect(
      getEffectivePolicies(connection, { organizationId, service, userId: memberId }),
    ).resolves.toMatchObject({ policies: [], statements: [] });
  });

  test("returns no policies without a grant and rejects cross-tenant subjects", async () => {
    await expect(
      getEffectivePolicies(connection, { organizationId, service, userId: noGrantId }),
    ).resolves.toMatchObject({ policies: [], statements: [] });
    await expect(
      getEffectivePolicies(connection, { organizationId, service, userId: outsiderId }),
    ).rejects.toBeInstanceOf(EffectivePolicyAuthorizationError);
  });
});
