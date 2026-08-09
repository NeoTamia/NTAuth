import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "@/client";
import { deleteAuditEventsForTest } from "@/test-support";
import {
  createIamPolicy,
  createIamPolicyVersion,
  getIamPolicyHistory,
  IamPolicyAuthorizationError,
  IamPolicyConflictError,
  IamPolicyValidationError,
  listIamPolicies,
  rollbackIamPolicy,
  setIamPolicyStatus,
} from "@/iam-policies";
import { applyMigrations } from "@/migrations";
import {
  auditEvents,
  iamCatalogEntries,
  organizationMembers,
  organizations,
  services,
  user,
} from "@/schema";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("IAM policy versioning", () => {
  let connection: DatabaseConnection;
  const runId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const outsiderId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const otherOrganizationId = crypto.randomUUID();
  const service = `policy-${runId}`;
  const action = `${service}:report:read`;
  const resource = `${service}:report:*`;
  const actor = (userId: string, suffix: string) => ({
    requestId: `${runId}-${suffix}`,
    userId,
  });
  const document = (effect: "Allow" | "Deny") => ({
    statements: [{ actions: [action], effect, resources: [resource] }],
    version: "2026-01-01" as const,
  });

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 4 });
    await applyMigrations(connection);
    await connection.db.insert(user).values([
      {
        email: `policy-owner-${runId}@example.test`,
        emailVerified: true,
        id: ownerId,
        name: "Policy owner",
      },
      {
        email: `policy-outsider-${runId}@example.test`,
        emailVerified: true,
        id: outsiderId,
        name: "Policy outsider",
      },
    ]);
    await connection.db.insert(organizations).values([
      { id: organizationId, name: "Policy organization", slug: `policy-${runId}` },
      { id: otherOrganizationId, name: "Other organization", slug: `other-policy-${runId}` },
    ]);
    await connection.db.insert(organizationMembers).values([
      { organizationId, role: "owner", userId: ownerId },
      { organizationId: otherOrganizationId, role: "owner", userId: outsiderId },
    ]);
    await connection.db.insert(services).values({
      key: service,
      name: "Policy test service",
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
    await connection.db.delete(user).where(eq(user.id, outsiderId));
    await connection.close();
  });

  test("creates immutable history and rolls back by appending a version", async () => {
    const created = await createIamPolicy(
      connection,
      { document: document("Allow"), name: "Reports", organizationId, service },
      actor(ownerId, "create"),
    );
    expect(created.policy.currentVersion).toBe(1);
    expect(created.version.documentHash).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      listIamPolicies(connection, { organizationId, service }, actor(ownerId, "list")),
    ).resolves.toEqual([
      expect.objectContaining({ currentVersion: 1, id: created.policy.id, name: "Reports" }),
    ]);

    const updated = await createIamPolicyVersion(
      connection,
      { document: document("Deny"), expectedVersion: 1, policyId: created.policy.id },
      actor(ownerId, "update"),
    );
    expect(updated.version.version).toBe(2);
    await expect(
      createIamPolicyVersion(
        connection,
        { document: document("Allow"), expectedVersion: 1, policyId: created.policy.id },
        actor(ownerId, "stale"),
      ),
    ).rejects.toBeInstanceOf(IamPolicyConflictError);

    const rollback = await rollbackIamPolicy(
      connection,
      { expectedVersion: 2, policyId: created.policy.id, targetVersion: 1 },
      actor(ownerId, "rollback"),
    );
    expect(rollback.version).toMatchObject({
      document: document("Allow"),
      sourceVersion: 1,
      version: 3,
    });
    const history = await getIamPolicyHistory(
      connection,
      created.policy.id,
      actor(ownerId, "history"),
    );
    expect(history.versions.map((version) => version.version)).toEqual([1, 2, 3]);

    await expect(
      Promise.resolve(
        connection.client`
          update iam_policy_versions
          set document_hash = ${"0".repeat(64)}
          where policy_id = ${created.policy.id}
        `,
      ),
    ).rejects.toThrow("IAM policy versions are immutable");
    await expect(
      setIamPolicyStatus(
        connection,
        { policyId: created.policy.id, status: "inactive" },
        actor(ownerId, "disable"),
      ),
    ).resolves.toMatchObject({ status: "inactive" });
  });

  test("serializes concurrent writes without gaps", async () => {
    const created = await createIamPolicy(
      connection,
      { document: document("Allow"), name: "Concurrent", organizationId, service },
      actor(ownerId, "concurrent-create"),
    );
    const results = await Promise.allSettled([
      createIamPolicyVersion(
        connection,
        { document: document("Deny"), expectedVersion: 1, policyId: created.policy.id },
        actor(ownerId, "concurrent-a"),
      ),
      createIamPolicyVersion(
        connection,
        { document: document("Deny"), expectedVersion: 1, policyId: created.policy.id },
        actor(ownerId, "concurrent-b"),
      ),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(IamPolicyConflictError);
    expect(
      (
        await getIamPolicyHistory(
          connection,
          created.policy.id,
          actor(ownerId, "concurrent-history"),
        )
      ).versions.map((version) => version.version),
    ).toEqual([1, 2]);
  });

  test("fails closed for invalid catalogues and cross-tenant actors", async () => {
    await expect(
      createIamPolicy(
        connection,
        {
          document: {
            statements: [
              { actions: [`${service}:report:delete`], effect: "Allow", resources: [resource] },
            ],
            version: "2026-01-01",
          },
          name: "Invalid",
          organizationId,
          service,
        },
        actor(ownerId, "invalid"),
      ),
    ).rejects.toBeInstanceOf(IamPolicyValidationError);
    await expect(
      createIamPolicy(
        connection,
        { document: document("Allow"), name: "Cross tenant", organizationId, service },
        actor(outsiderId, "denied"),
      ),
    ).rejects.toBeInstanceOf(IamPolicyAuthorizationError);
    await expect(
      listIamPolicies(connection, { organizationId, service }, actor(outsiderId, "list-denied")),
    ).rejects.toBeInstanceOf(IamPolicyAuthorizationError);

    const denied = await connection.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.requestId, `${runId}-denied`));
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ action: "iam.policy.create", outcome: "denied" });
  });
});
