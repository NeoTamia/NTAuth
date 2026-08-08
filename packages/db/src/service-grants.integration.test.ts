import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "./client";
import { applyMigrations } from "./migrations";
import {
  createServiceGrant,
  hasActiveServiceGrant,
  listServiceGrants,
  revokeServiceGrant,
  ServiceGrantAuthorizationError,
  ServiceGrantConflictError,
  setServiceGrantActive,
} from "./service-grants";
import { auditEvents, organizationMembers, organizations, serviceGrants, user } from "./schema";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("organization service grants", () => {
  let connection: DatabaseConnection;
  const runId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const outsiderId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const otherOrganizationId = crypto.randomUUID();
  const actor = (suffix: string) => ({ requestId: `${runId}-${suffix}`, userId: ownerId });

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 4 });
    await applyMigrations(connection);
    await connection.db.insert(user).values([
      {
        email: `grant-owner-${runId}@example.test`,
        emailVerified: true,
        id: ownerId,
        name: "Grant owner",
      },
      {
        email: `grant-member-${runId}@example.test`,
        emailVerified: true,
        id: memberId,
        name: "Grant member",
      },
      {
        email: `grant-outsider-${runId}@example.test`,
        emailVerified: true,
        id: outsiderId,
        name: "Grant outsider",
      },
    ]);
    await connection.db.insert(organizations).values([
      { id: organizationId, name: "Grant organization", slug: `grant-${runId}` },
      { id: otherOrganizationId, name: "Other organization", slug: `other-${runId}` },
    ]);
    await connection.db.insert(organizationMembers).values([
      { organizationId, role: "owner", userId: ownerId },
      { organizationId, role: "member", userId: memberId },
      { organizationId: otherOrganizationId, role: "owner", userId: outsiderId },
    ]);
  });

  afterAll(async () => {
    await connection.client`delete from audit_events where request_id like ${`${runId}-%`}`;
    await connection.db.delete(organizations).where(eq(organizations.id, organizationId));
    await connection.db.delete(organizations).where(eq(organizations.id, otherOrganizationId));
    await connection.db.delete(user).where(eq(user.id, ownerId));
    await connection.db.delete(user).where(eq(user.id, memberId));
    await connection.db.delete(user).where(eq(user.id, outsiderId));
    await connection.close();
  });

  test("creates, toggles, revokes and re-grants one scoped subject", async () => {
    const grant = await createServiceGrant(
      connection,
      { organizationId, service: "ntscout", userId: memberId },
      actor("create"),
    );
    expect(grant).toMatchObject({
      organizationId,
      service: "ntscout",
      status: "active",
      userId: memberId,
    });
    await expect(
      hasActiveServiceGrant(connection, { organizationId, service: "ntscout", userId: memberId }),
    ).resolves.toBe(true);
    await expect(
      createServiceGrant(
        connection,
        { organizationId, service: "ntscout", userId: memberId },
        actor("duplicate"),
      ),
    ).rejects.toBeInstanceOf(ServiceGrantConflictError);

    const inactive = await setServiceGrantActive(
      connection,
      { active: false, grantId: grant.id },
      actor("disable"),
    );
    expect(inactive.status).toBe("inactive");
    await expect(
      hasActiveServiceGrant(connection, { organizationId, service: "ntscout", userId: memberId }),
    ).resolves.toBe(false);
    expect(
      (
        await setServiceGrantActive(
          connection,
          { active: true, grantId: grant.id },
          actor("enable"),
        )
      ).status,
    ).toBe("active");

    const revoked = await revokeServiceGrant(connection, grant.id, actor("revoke"));
    expect(revoked).toMatchObject({ revokedByUserId: ownerId, status: "revoked" });
    expect(revoked.revokedAt).toBeInstanceOf(Date);
    await expect(
      hasActiveServiceGrant(connection, { organizationId, service: "ntscout", userId: memberId }),
    ).resolves.toBe(false);
    await expect(
      revokeServiceGrant(connection, grant.id, actor("revoke-repeat")),
    ).resolves.toMatchObject({
      id: grant.id,
      status: "revoked",
    });

    const replacement = await createServiceGrant(
      connection,
      { active: false, organizationId, service: "ntscout", userId: memberId },
      actor("replace"),
    );
    expect(replacement).toMatchObject({ status: "inactive" });
    expect(replacement.id).not.toBe(grant.id);
    const listed = await listServiceGrants(
      connection,
      { organizationId, service: "ntscout", userId: memberId },
      actor("list"),
    );
    expect(listed).toHaveLength(2);

    const events = await connection.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.organizationId, organizationId));
    expect(
      events.filter((event) => event.requestId.startsWith(runId)).map((event) => event.action),
    ).toEqual(
      expect.arrayContaining([
        "service-grant.create",
        "service-grant.status.change",
        "service-grant.revoke",
      ]),
    );
  });

  test("fails closed for cross-tenant targets and unauthorized actors", async () => {
    await expect(
      createServiceGrant(
        connection,
        { organizationId, service: "inventory", userId: outsiderId },
        actor("cross-tenant"),
      ),
    ).rejects.toBeInstanceOf(ServiceGrantAuthorizationError);
    await expect(
      listServiceGrants(
        connection,
        { organizationId, service: "inventory" },
        { requestId: `${runId}-unauthorized-list`, userId: outsiderId },
      ),
    ).rejects.toBeInstanceOf(ServiceGrantAuthorizationError);
    await expect(
      createServiceGrant(
        connection,
        { organizationId, service: "inventory", userId: memberId },
        { requestId: `${runId}-unauthorized`, userId: outsiderId },
      ),
    ).rejects.toBeInstanceOf(ServiceGrantAuthorizationError);
    expect(
      await connection.db
        .select()
        .from(serviceGrants)
        .where(
          and(
            eq(serviceGrants.organizationId, organizationId),
            eq(serviceGrants.service, "inventory"),
          ),
        ),
    ).toEqual([]);
    const denied = await connection.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.outcome, "denied"));
    expect(
      denied.filter((event) => event.requestId.startsWith(runId)).map((event) => event.requestId),
    ).toEqual(
      expect.arrayContaining([
        `${runId}-cross-tenant`,
        `${runId}-unauthorized`,
        `${runId}-unauthorized-list`,
      ]),
    );
  });

  test("serializes concurrent creation to one current grant", async () => {
    const results = await Promise.allSettled([
      createServiceGrant(
        connection,
        { organizationId, service: "concurrent", userId: memberId },
        actor("concurrent-a"),
      ),
      createServiceGrant(
        connection,
        { organizationId, service: "concurrent", userId: memberId },
        actor("concurrent-b"),
      ),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(ServiceGrantConflictError);
    expect(
      await connection.db
        .select()
        .from(serviceGrants)
        .where(
          and(
            eq(serviceGrants.organizationId, organizationId),
            eq(serviceGrants.service, "concurrent"),
            eq(serviceGrants.userId, memberId),
          ),
        ),
    ).toHaveLength(1);
  });
});
