import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { verifyPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { bootstrapPlatformAdmin, BootstrapAdminConflictError } from "@/bootstrap-admin";
import { createDatabase, type DatabaseConnection } from "@/client";
import { applyMigrations } from "@/migrations";
import { account, auditEvents, platformRoleAssignments, user } from "@/schema";
import { deleteAuditEventsForTest } from "@/test-support";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("first platform administrator bootstrap", () => {
  let connection: DatabaseConnection;
  const runId = crypto.randomUUID();
  const email = `bootstrap-${runId}@example.test`;
  const password = "Bootstrap-password-123!";

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 2 });
    await applyMigrations(connection);
  });

  afterAll(async () => {
    await deleteAuditEventsForTest(connection, { requestIdPrefixes: [`${runId}-`] });
    await connection.db.delete(user).where(eq(user.email, email));
    await connection.close();
  });

  test("creates one verified credential identity and an auditable platform role", async () => {
    const result = await bootstrapPlatformAdmin(connection, {
      email,
      name: "Bootstrap administrator",
      password,
      requestId: `${runId}-create`,
    });

    expect(result.created).toBe(true);
    const [identity] = await connection.db.select().from(user).where(eq(user.id, result.userId));
    const [credential] = await connection.db
      .select()
      .from(account)
      .where(eq(account.userId, result.userId));
    const roles = await connection.db
      .select()
      .from(platformRoleAssignments)
      .where(eq(platformRoleAssignments.userId, result.userId));
    const [audit] = await connection.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.requestId, `${runId}-create`));

    expect(identity).toMatchObject({ email, emailVerified: true, status: "active" });
    expect(credential?.password).not.toBe(password);
    expect(await verifyPassword({ hash: credential!.password!, password })).toBe(true);
    expect(roles).toEqual([expect.objectContaining({ role: "platform_admin" })]);
    expect(audit).toMatchObject({
      action: "platform_admin.bootstrap",
      actorUserId: result.userId,
      metadata: { idempotent: false },
      outcome: "success",
      resourceId: result.userId,
    });
  });

  test("is idempotent for the same administrator without resetting its password", async () => {
    const result = await bootstrapPlatformAdmin(connection, {
      email,
      name: "Ignored name",
      password: "A-different-password-123!",
      requestId: `${runId}-repeat`,
    });
    const [credential] = await connection.db
      .select({ password: account.password })
      .from(account)
      .where(eq(account.userId, result.userId));

    expect(result.created).toBe(false);
    expect(await verifyPassword({ hash: credential!.password!, password })).toBe(true);
    expect(
      await verifyPassword({ hash: credential!.password!, password: "A-different-password-123!" }),
    ).toBe(false);
  });

  test("refuses to bootstrap a different identity once an administrator exists", async () => {
    await expect(
      bootstrapPlatformAdmin(connection, {
        email: `other-${runId}@example.test`,
        name: "Other administrator",
        password,
        requestId: `${runId}-conflict`,
      }),
    ).rejects.toBeInstanceOf(BootstrapAdminConflictError);
  });
});
