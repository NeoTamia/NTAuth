import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "@/client";
import { deleteAuditEventsForTest } from "@/test-support";
import { applyMigrations } from "@/migrations";
import { revokeUserSessions } from "@/sessions";
import {
  account,
  auditEvents,
  organizationMembers,
  organizations,
  platformRoleAssignments,
  session,
  user,
} from "@/schema";
import {
  deleteUser,
  getPlatformUserAdministration,
  InvalidUserLifecycleTransitionError,
  listPlatformUsers,
  setUserStatus,
  UserLifecycleAuthorizationError,
} from "@/user-lifecycle";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("user lifecycle", () => {
  let connection: DatabaseConnection;
  const runId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const targetId = crypto.randomUUID();
  const unauthorizedId = crypto.randomUUID();

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 2 });
    await applyMigrations(connection);
    await connection.db.insert(user).values([
      { email: `lifecycle-admin-${runId}@example.test`, id: adminId, name: "Admin" },
      { email: `lifecycle-target-${runId}@example.test`, id: targetId, name: "Target" },
      { email: `lifecycle-user-${runId}@example.test`, id: unauthorizedId, name: "User" },
    ]);
    await connection.db
      .insert(platformRoleAssignments)
      .values({ role: "platform_admin", userId: adminId });
  });

  afterAll(async () => {
    await deleteAuditEventsForTest(connection, { requestIdPrefixes: [`${runId}-`] });
    await connection.client`delete from "user" where id in (${adminId}, ${targetId}, ${unauthorizedId})`;
    await connection.close();
  });

  test("suspends, revokes sessions, and reactivates with a controlled clock", async () => {
    await connection.db.insert(session).values({
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      id: crypto.randomUUID(),
      token: `lifecycle-${runId}`,
      userId: targetId,
    });
    const suspendedAt = new Date("2026-08-08T08:00:00.000Z");
    await expect(
      setUserStatus(
        connection,
        { status: "suspended", userId: targetId },
        { requestId: `${runId}-suspend`, userId: adminId },
        suspendedAt,
      ),
    ).resolves.toMatchObject({ id: targetId, status: "suspended" });

    expect(
      await connection.db.select().from(session).where(eq(session.userId, targetId)),
    ).toHaveLength(0);
    const [suspended] = await connection.db.select().from(user).where(eq(user.id, targetId));
    expect(suspended?.statusChangedAt).toEqual(suspendedAt);

    await expect(
      setUserStatus(
        connection,
        { status: "active", userId: targetId },
        { requestId: `${runId}-reactivate`, userId: adminId },
      ),
    ).resolves.toMatchObject({ status: "active" });
  });

  test("rejects and audits unauthorized lifecycle changes", async () => {
    await expect(
      setUserStatus(
        connection,
        { status: "deactivated", userId: targetId },
        { requestId: `${runId}-denied`, userId: unauthorizedId },
      ),
    ).rejects.toBeInstanceOf(UserLifecycleAuthorizationError);
    const [target] = await connection.db.select().from(user).where(eq(user.id, targetId));
    const [audit] = await connection.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.requestId, `${runId}-denied`));
    expect(target?.status).toBe("active");
    expect(audit).toMatchObject({ outcome: "denied", action: "user.deactivate" });
  });

  test("lists, filters and inspects identities without exposing session tokens", async () => {
    await connection.db.insert(session).values({
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      id: crypto.randomUUID(),
      ipAddress: "127.0.0.1",
      token: `registry-${runId}`,
      userAgent: "Chrome",
      userId: targetId,
    });
    const registry = await listPlatformUsers(
      connection,
      { limit: 1, offset: 0, query: `lifecycle-target-${runId}` },
      { requestId: `${runId}-list`, userId: adminId },
    );
    expect(registry.total).toBe(1);
    expect(registry.items).toEqual([
      expect.objectContaining({ id: targetId, sessionCount: 1, status: "active" }),
    ]);
    const detail = await getPlatformUserAdministration(connection, targetId, {
      requestId: `${runId}-read`,
      userId: adminId,
    });
    expect(detail.sessions).toHaveLength(1);
    expect(detail.sessions[0]).not.toHaveProperty("token");
    await expect(
      revokeUserSessions(
        connection,
        { reason: "administrative", userId: targetId },
        { requestId: `${runId}-revoke`, userId: adminId },
      ),
    ).resolves.toBe(1);
    await expect(
      listPlatformUsers(
        connection,
        { limit: 20, offset: 0 },
        { requestId: `${runId}-list-denied`, userId: unauthorizedId },
      ),
    ).rejects.toBeInstanceOf(UserLifecycleAuthorizationError);
  });

  test("anonymizes deletion while preserving audit identity and makes it terminal", async () => {
    const organizationId = crypto.randomUUID();
    await connection.db
      .insert(organizations)
      .values({ id: organizationId, name: "Lifecycle org", slug: `lifecycle-${runId}` });
    await connection.db
      .insert(organizationMembers)
      .values({ organizationId, role: "member", userId: targetId });
    await connection.db.insert(account).values({
      accountId: targetId,
      id: crypto.randomUUID(),
      providerId: "credential",
      userId: targetId,
    });

    const deletedAt = new Date("2026-08-08T09:00:00.000Z");
    await deleteUser(
      connection,
      targetId,
      { requestId: `${runId}-delete`, userId: adminId },
      deletedAt,
    );
    const [deleted] = await connection.db.select().from(user).where(eq(user.id, targetId));
    expect(deleted).toMatchObject({
      deletedAt,
      emailVerified: false,
      name: "Deleted user",
      status: "deleted",
    });
    expect(deleted?.email).toBe(`deleted+${targetId}@invalid.ntauth.local`);
    expect(
      await connection.db.select().from(account).where(eq(account.userId, targetId)),
    ).toHaveLength(0);
    expect(
      await connection.db
        .select()
        .from(organizationMembers)
        .where(eq(organizationMembers.userId, targetId)),
    ).toHaveLength(0);

    await expect(
      setUserStatus(
        connection,
        { status: "active", userId: targetId },
        { requestId: `${runId}-reuse`, userId: adminId },
      ),
    ).rejects.toBeInstanceOf(InvalidUserLifecycleTransitionError);
  });
});
