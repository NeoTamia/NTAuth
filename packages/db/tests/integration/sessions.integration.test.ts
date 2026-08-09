import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "@/client";
import { deleteAuditEventsForTest } from "@/test-support";
import { applyMigrations } from "@/migrations";
import { revokeUserSessions, SessionRevocationAuthorizationError } from "@/sessions";
import { auditEvents, platformRoleAssignments, session, user } from "@/schema";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("administrative session revocation", () => {
  let connection: DatabaseConnection;
  const runId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const targetId = crypto.randomUUID();

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 2 });
    await applyMigrations(connection);
    await connection.db.insert(user).values([
      {
        email: `session-admin-${runId}@example.test`,
        emailVerified: true,
        id: adminId,
        name: "Session admin",
      },
      {
        email: `session-target-${runId}@example.test`,
        emailVerified: true,
        id: targetId,
        name: "Session target",
      },
    ]);
    await connection.db
      .insert(platformRoleAssignments)
      .values({ role: "platform_admin", userId: adminId });
  });

  afterAll(async () => {
    await deleteAuditEventsForTest(connection, { requestIdPrefixes: [`${runId}-`] });
    await connection.client`delete from "user" where id in (${adminId}, ${targetId})`;
    await connection.close();
  });

  test("revokes every target session immediately and audits only safe metadata", async () => {
    const secretToken = `secret-${runId}`;
    await connection.db.insert(session).values([
      {
        expiresAt: new Date(Date.now() + 60_000),
        id: crypto.randomUUID(),
        token: secretToken,
        userId: targetId,
      },
      {
        expiresAt: new Date(Date.now() + 60_000),
        id: crypto.randomUUID(),
        token: `other-${runId}`,
        userId: targetId,
      },
    ]);

    await expect(
      revokeUserSessions(
        connection,
        { reason: "compromised", userId: targetId },
        { requestId: `${runId}-success`, userId: adminId },
      ),
    ).resolves.toBe(2);

    const remaining = await connection.db
      .select()
      .from(session)
      .where(eq(session.userId, targetId));
    expect(remaining).toHaveLength(0);

    const [audit] = await connection.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.requestId, `${runId}-success`));
    expect(audit?.outcome).toBe("success");
    expect(JSON.stringify(audit?.metadata)).not.toContain(secretToken);
  });

  test("retains sessions and audits an unauthorized administrative attempt", async () => {
    await connection.db.insert(session).values({
      expiresAt: new Date(Date.now() + 60_000),
      id: crypto.randomUUID(),
      token: `retained-${runId}`,
      userId: targetId,
    });

    await expect(
      revokeUserSessions(
        connection,
        { reason: "administrative", userId: targetId },
        { requestId: `${runId}-denied`, userId: targetId },
      ),
    ).rejects.toBeInstanceOf(SessionRevocationAuthorizationError);

    const retained = await connection.db.select().from(session).where(eq(session.userId, targetId));
    expect(retained).toHaveLength(1);

    const denied = await connection.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.requestId, `${runId}-denied`), eq(auditEvents.outcome, "denied")));
    expect(denied).toHaveLength(1);
  });
});
