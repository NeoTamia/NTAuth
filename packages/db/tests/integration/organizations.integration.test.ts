import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "../../src/client";
import { deleteAuditEventsForTest } from "../../src/test-support";
import { applyMigrations } from "../../src/migrations";
import {
  addOrganizationMember,
  changeOrganizationMemberRole,
  createOrganization,
  getOrganizationAdministration,
  listManagedOrganizations,
  OrganizationAuthorizationError,
  OrganizationConflictError,
  updateOrganization,
  updateOrganizationMember,
} from "../../src/organizations";
import { auditEvents, organizationMembers, platformRoleAssignments, user } from "../../src/schema";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("organization domain", () => {
  let connection: DatabaseConnection;
  const runId = crypto.randomUUID();
  const platformAdminId = crypto.randomUUID();
  const organizationAdminId = crypto.randomUUID();
  const memberId = crypto.randomUUID();

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 2 });
    await applyMigrations(connection);
    await connection.db.insert(user).values([
      {
        email: `platform-${runId}@example.test`,
        emailVerified: true,
        id: platformAdminId,
        name: "Platform admin",
      },
      {
        email: `organization-${runId}@example.test`,
        emailVerified: true,
        id: organizationAdminId,
        name: "Organization admin",
      },
      {
        email: `member-${runId}@example.test`,
        emailVerified: true,
        id: memberId,
        name: "Member",
      },
    ]);
    await connection.db
      .insert(platformRoleAssignments)
      .values({ role: "platform_admin", userId: platformAdminId });
  });

  afterAll(async () => {
    await deleteAuditEventsForTest(connection, { requestIdPrefixes: [`${runId}-`] });
    await connection.client`delete from organizations where slug = ${`neotamia-${runId}`}`;
    await connection.client`delete from "user" where id in (${platformAdminId}, ${organizationAdminId}, ${memberId})`;
    await connection.close();
  });

  test("keeps platform and organization roles separate and enforces unique memberships", async () => {
    const organization = await createOrganization(
      connection,
      { name: "NeoTamia Test", slug: `neotamia-${runId}` },
      { requestId: `${runId}-create`, userId: platformAdminId },
    );
    await addOrganizationMember(
      connection,
      { organizationId: organization.id, role: "admin", userId: organizationAdminId },
      { requestId: `${runId}-add-admin`, userId: platformAdminId },
    );
    await addOrganizationMember(
      connection,
      { organizationId: organization.id, role: "member", userId: memberId },
      { requestId: `${runId}-add-member`, userId: organizationAdminId },
    );

    await expect(
      addOrganizationMember(
        connection,
        { organizationId: organization.id, role: "member", userId: memberId },
        { requestId: `${runId}-duplicate`, userId: platformAdminId },
      ),
    ).rejects.toThrow();

    const memberships = await connection.db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.organizationId, organization.id));
    expect(memberships).toHaveLength(2);
    expect(memberships.map(({ role }) => role).toSorted()).toEqual(["admin", "member"]);

    const platformRoles = await connection.db
      .select()
      .from(platformRoleAssignments)
      .where(eq(platformRoleAssignments.userId, organizationAdminId));
    expect(platformRoles).toHaveLength(0);

    const changedMembership = await changeOrganizationMemberRole(
      connection,
      { organizationId: organization.id, role: "owner", userId: memberId },
      { requestId: `${runId}-change-role`, userId: organizationAdminId },
    );
    expect(changedMembership.role).toBe("owner");

    const successfulAudits = await connection.db
      .select()
      .from(auditEvents)
      .where(
        and(eq(auditEvents.organizationId, organization.id), eq(auditEvents.outcome, "success")),
      );
    expect(successfulAudits).toHaveLength(4);

    const visibleOrganizations = await listManagedOrganizations(connection, {
      requestId: `${runId}-list`,
      userId: organizationAdminId,
    });
    expect(visibleOrganizations).toContainEqual(
      expect.objectContaining({
        administratorCount: 2,
        id: organization.id,
        memberCount: 2,
      }),
    );

    const administration = await getOrganizationAdministration(connection, organization.id, {
      requestId: `${runId}-read`,
      userId: organizationAdminId,
    });
    expect(administration.members).toHaveLength(2);
    expect(administration.organization.name).toBe("NeoTamia Test");

    const updated = await updateOrganization(
      connection,
      { id: organization.id, name: "NeoTamia Updated", status: "active" },
      { requestId: `${runId}-update`, userId: organizationAdminId },
    );
    expect(updated.name).toBe("NeoTamia Updated");

    await updateOrganizationMember(
      connection,
      {
        organizationId: organization.id,
        role: "member",
        status: "active",
        userId: organizationAdminId,
      },
      { requestId: `${runId}-demote-admin`, userId: platformAdminId },
    );
    await expect(
      updateOrganizationMember(
        connection,
        {
          organizationId: organization.id,
          role: "member",
          status: "active",
          userId: memberId,
        },
        { requestId: `${runId}-last-admin`, userId: platformAdminId },
      ),
    ).rejects.toBeInstanceOf(OrganizationConflictError);
  });

  test("audits a denied mutation without creating a membership", async () => {
    const [adminMembership] = await connection.db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, organizationAdminId));
    const organizationId = adminMembership!.organizationId;

    await connection.db
      .update(organizationMembers)
      .set({ role: "member" })
      .where(eq(organizationMembers.userId, organizationAdminId));

    await expect(
      addOrganizationMember(
        connection,
        { organizationId, role: "owner", userId: platformAdminId },
        { requestId: `${runId}-denied`, userId: organizationAdminId },
      ),
    ).rejects.toBeInstanceOf(OrganizationAuthorizationError);

    const deniedAudit = await connection.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.requestId, `${runId}-denied`), eq(auditEvents.outcome, "denied")));
    expect(deniedAudit).toHaveLength(1);

    const forbiddenMembership = await connection.db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.userId, platformAdminId),
        ),
      );
    expect(forbiddenMembership).toHaveLength(0);
  });
});
