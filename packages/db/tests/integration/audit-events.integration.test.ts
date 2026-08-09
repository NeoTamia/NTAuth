import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, like } from "drizzle-orm";

import {
  AUDIT_RETENTION_DAYS,
  AuditEventAuthorizationError,
  AuditEventInputError,
  exportIamAuditEvents,
  listIamAuditEvents,
  purgeExpiredAuditEvents,
} from "../../src/audit-events";
import { applyMigrations } from "../../src/migrations";
import { auditEvents, organizationMembers, organizations, services, user } from "../../src/schema";
import { createDatabase, type DatabaseConnection } from "../../src/client";
import { deleteAuditEventsForTest } from "../../src/test-support";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("IAM audit event journal", () => {
  let connection: DatabaseConnection;
  const runId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const outsiderId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const otherOrganizationId = crypto.randomUUID();
  const service = `audit-${runId}`;
  const actor = { requestId: `${runId}-read`, userId: ownerId };

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 3 });
    await applyMigrations(connection);
    await connection.db.insert(user).values([
      { email: `${runId}-owner@example.test`, emailVerified: true, id: ownerId, name: "Owner" },
      {
        email: `${runId}-outsider@example.test`,
        emailVerified: true,
        id: outsiderId,
        name: "Outsider",
      },
    ]);
    await connection.db.insert(organizations).values([
      { id: organizationId, name: "Audit organization", slug: `audit-${runId}` },
      { id: otherOrganizationId, name: "Other organization", slug: `audit-other-${runId}` },
    ]);
    await connection.db.insert(organizationMembers).values([
      { organizationId, role: "owner", userId: ownerId },
      { organizationId: otherOrganizationId, role: "owner", userId: outsiderId },
    ]);
    await connection.db
      .insert(services)
      .values({ key: service, name: "Audit service", ownerUserId: ownerId });
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

  test("returns a scoped, redacted and stable cursor page", async () => {
    const createdAt = new Date("2026-08-08T12:00:00.000Z");
    await Promise.all(
      ["create", "status.change", "revoke"].map((suffix) =>
        connection.db.insert(auditEvents).values({
          action: `service-grant.${suffix}`,
          actorUserId: ownerId,
          createdAt,
          metadata: { password: "never-return", service: "ntscout", targetUserId: ownerId },
          organizationId,
          outcome: "success",
          requestId: `${runId}-${suffix}`,
          resourceId: crypto.randomUUID(),
          resourceType: "service_grant",
        }),
      ),
    );

    const first = await listIamAuditEvents(
      connection,
      { limit: 2, organizationId, service: "ntscout" },
      actor,
      new Date("2026-08-08T13:00:00.000Z"),
    );
    expect(first.events).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    expect(first.events[0]).toMatchObject({
      actor: { id: ownerId, type: "user" },
      scope: { organizationId, service: "ntscout" },
      target: { type: "service_grant" },
    });
    expect(JSON.stringify(first.events)).not.toContain("never-return");

    const second = await listIamAuditEvents(
      connection,
      { cursor: first.nextCursor!, limit: 2, organizationId, service: "ntscout" },
      actor,
      new Date("2026-08-08T13:00:00.000Z"),
    );
    expect(second.events).toHaveLength(1);
    expect(new Set([...first.events, ...second.events].map(({ id }) => id)).size).toBe(3);

    const filtered = await listIamAuditEvents(
      connection,
      {
        actorUserId: ownerId,
        from: new Date("2026-08-08T11:59:00.000Z"),
        organizationId,
        service: "ntscout",
        to: new Date("2026-08-08T12:01:00.000Z"),
      },
      actor,
      new Date("2026-08-08T13:00:00.000Z"),
    );
    expect(filtered.events).toHaveLength(3);

    const exported = await exportIamAuditEvents(
      connection,
      { organizationId, service: "ntscout" },
      { requestId: `${runId}-export`, userId: ownerId },
      new Date("2026-08-08T13:00:00.000Z"),
    );
    expect(exported).toMatchObject({ retentionDays: 365, truncated: false });
    expect(exported.events).toHaveLength(3);
    expect(
      await connection.db
        .select({ outcome: auditEvents.outcome })
        .from(auditEvents)
        .where(eq(auditEvents.requestId, `${runId}-export`)),
    ).toEqual([{ outcome: "success" }]);
  });

  test("fails closed for cross-tenant actors and invalid filters", async () => {
    await expect(
      listIamAuditEvents(connection, { organizationId }, { ...actor, userId: outsiderId }),
    ).rejects.toBeInstanceOf(AuditEventAuthorizationError);
    await expect(
      listIamAuditEvents(connection, { limit: 101, organizationId }, actor),
    ).rejects.toBeInstanceOf(AuditEventInputError);
    await expect(
      listIamAuditEvents(connection, { organizationId, service: "../secret" }, actor),
    ).rejects.toBeInstanceOf(AuditEventInputError);
    await expect(
      listIamAuditEvents(
        connection,
        {
          from: new Date("2026-08-09T00:00:00.000Z"),
          organizationId,
          to: new Date("2026-08-08T00:00:00.000Z"),
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(AuditEventInputError);
  });

  test("returns global catalogue events only to the service owner", async () => {
    await connection.db.insert(auditEvents).values({
      action: "iam.catalog.create",
      actorUserId: ownerId,
      metadata: { identifier: `${service}:report:read`, service },
      outcome: "success",
      requestId: `${runId}-catalogue`,
      resourceId: crypto.randomUUID(),
      resourceType: "iam_catalog_entry",
    });
    const page = await listIamAuditEvents(connection, { service }, actor);
    expect(page.events).toHaveLength(1);
    expect(page.events[0]?.scope).toEqual({ organizationId: null, service });
    await expect(
      listIamAuditEvents(connection, { service }, { ...actor, userId: outsiderId }),
    ).rejects.toBeInstanceOf(AuditEventAuthorizationError);
  });

  test("keeps rows immutable and purges only beyond retention", async () => {
    const [old] = await connection.db
      .insert(auditEvents)
      .values({
        action: "iam.policy.create",
        actorUserId: ownerId,
        createdAt: new Date("2025-08-07T00:00:00.000Z"),
        metadata: { service: "ntscout" },
        organizationId,
        outcome: "success",
        requestId: `${runId}-expired`,
        resourceType: "iam_policy",
      })
      .returning();
    await expect(
      connection.db
        .update(auditEvents)
        .set({ outcome: "denied" })
        .where(eq(auditEvents.id, old!.id))
        .execute(),
    ).rejects.toThrow();
    const [unchanged] = await connection.db
      .select({ outcome: auditEvents.outcome })
      .from(auditEvents)
      .where(eq(auditEvents.id, old!.id));
    expect(unchanged?.outcome).toBe("success");
    await expect(
      connection.db.delete(auditEvents).where(eq(auditEvents.id, old!.id)).execute(),
    ).rejects.toThrow();

    const removed = await purgeExpiredAuditEvents(connection, new Date("2026-08-08T00:00:00.000Z"));
    expect(removed.map(({ id }) => id)).toContain(old!.id);
    expect(AUDIT_RETENTION_DAYS).toBe(365);
    const current = await connection.db
      .select({ id: auditEvents.id })
      .from(auditEvents)
      .where(like(auditEvents.requestId, `${runId}-%`));
    expect(current.length).toBeGreaterThan(0);
  });
});
