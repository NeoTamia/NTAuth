import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "./client";
import { applyMigrations } from "./migrations";
import {
  changePassword,
  completePasswordReset,
  InvalidCurrentPasswordError,
  InvalidPasswordResetError,
  requestPasswordReset,
} from "./passwords";
import { account, auditEvents, jobs, passwordResetRequests, session, user } from "./schema";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("password lifecycle", () => {
  let connection: DatabaseConnection;
  const runId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const email = `password-${runId}@example.test`;

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 2 });
    await applyMigrations(connection);
    await connection.db
      .insert(user)
      .values({ email, emailVerified: true, id: userId, name: "Password user" });
    await connection.db.insert(account).values({
      accountId: userId,
      id: crypto.randomUUID(),
      password: "old-hash",
      providerId: "credential",
      userId,
    });
  });

  afterAll(async () => {
    await connection.client`delete from audit_events where resource_id = ${userId}`;
    await connection.client`delete from "user" where id = ${userId}`;
    await connection.close();
  });

  test("creates a hashed 30-minute reset, completes it once, and revokes sessions", async () => {
    const now = new Date("2026-08-08T10:00:00.000Z");
    const reset = await requestPasswordReset(
      connection,
      { email, resetBaseURL: "https://app.test/auth/reset" },
      now,
    );
    expect(reset?.expiresAt).toEqual(new Date(now.getTime() + 30 * 60 * 1_000));
    const [stored] = await connection.db
      .select()
      .from(passwordResetRequests)
      .where(eq(passwordResetRequests.id, reset!.id));
    expect(stored?.tokenHash).not.toBe(reset?.token);
    const [job] = await connection.db
      .select()
      .from(jobs)
      .where(eq(jobs.deduplicationKey, `password-reset:${reset!.id}`));
    expect(JSON.stringify(job?.payload)).toContain(reset!.token);

    await connection.db.insert(session).values({
      expiresAt: new Date("2030-01-01"),
      id: crypto.randomUUID(),
      token: `reset-${runId}`,
      userId,
    });
    await completePasswordReset(
      connection,
      { passwordHash: "new-hash", token: reset!.token },
      new Date(now.getTime() + 1_000),
    );
    expect(
      await connection.db.select().from(session).where(eq(session.userId, userId)),
    ).toHaveLength(0);
    const [credential] = await connection.db
      .select()
      .from(account)
      .where(eq(account.userId, userId));
    expect(credential?.password).toBe("new-hash");
    await expect(
      completePasswordReset(connection, { passwordHash: "reuse", token: reset!.token }, now),
    ).rejects.toBeInstanceOf(InvalidPasswordResetError);
  });

  test("returns no reset for unknown or suspended identities", async () => {
    expect(
      await requestPasswordReset(connection, {
        email: `unknown-${runId}@test`,
        resetBaseURL: "https://app.test/reset",
      }),
    ).toBeUndefined();
    await connection.db.update(user).set({ status: "suspended" }).where(eq(user.id, userId));
    expect(
      await requestPasswordReset(connection, { email, resetBaseURL: "https://app.test/reset" }),
    ).toBeUndefined();
    await connection.db.update(user).set({ status: "active" }).where(eq(user.id, userId));
  });

  test("rejects expired reset and changes an authenticated password atomically", async () => {
    const now = new Date("2026-08-08T11:00:00.000Z");
    const expired = await requestPasswordReset(
      connection,
      { email, resetBaseURL: "https://app.test/reset" },
      now,
    );
    await expect(
      completePasswordReset(
        connection,
        { passwordHash: "bad", token: expired!.token },
        new Date(now.getTime() + 31 * 60 * 1_000),
      ),
    ).rejects.toBeInstanceOf(InvalidPasswordResetError);

    await expect(
      changePassword(
        connection,
        { currentPassword: "wrong", passwordHash: "next", verify: async () => false },
        { requestId: `${runId}-wrong`, userId },
      ),
    ).rejects.toBeInstanceOf(InvalidCurrentPasswordError);
    await changePassword(
      connection,
      {
        currentPassword: "correct",
        passwordHash: "changed-hash",
        verify: async ({ hash, password }) => hash === "new-hash" && password === "correct",
      },
      { requestId: `${runId}-change`, userId },
    );
    const [audit] = await connection.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.requestId, `${runId}-change`));
    expect(audit?.action).toBe("password.change");
  });
});
