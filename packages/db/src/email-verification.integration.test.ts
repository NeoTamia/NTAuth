import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "./client";
import {
  completeEmailVerification,
  InvalidEmailVerificationError,
  requestEmailVerification,
} from "./email-verification";
import { applyMigrations } from "./migrations";
import { emailVerificationRequests, jobs, user } from "./schema";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("mandatory email verification", () => {
  let connection: DatabaseConnection;
  const runId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const email = `verify-${runId}@example.test`;
  const now = new Date("2026-08-08T13:00:00.000Z");

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 2 });
    await applyMigrations(connection);
    await connection.db.insert(user).values({ email, id: userId, name: "Unverified" });
  });

  afterAll(async () => {
    await connection.client`delete from jobs where payload->>'to' = ${email}`;
    await connection.client`delete from audit_events where resource_id = ${userId}`;
    await connection.client`delete from "user" where id = ${userId}`;
    await connection.close();
  });

  test("stores a hashed 24-hour token and resend invalidates the previous token", async () => {
    const first = await requestEmailVerification(
      connection,
      { email, verificationBaseURL: "https://app.test/auth/verify-email" },
      now,
    );
    const second = await requestEmailVerification(
      connection,
      { email, verificationBaseURL: "https://app.test/auth/verify-email" },
      new Date(now.getTime() + 1_000),
    );
    expect(first?.expiresAt).toEqual(new Date(now.getTime() + 24 * 60 * 60 * 1_000));
    const [stored] = await connection.db
      .select()
      .from(emailVerificationRequests)
      .where(eq(emailVerificationRequests.id, second!.id));
    expect(stored?.tokenHash).not.toBe(second?.token);
    const [job] = await connection.db
      .select()
      .from(jobs)
      .where(eq(jobs.deduplicationKey, `email-verification:${second!.id}`));
    expect(JSON.stringify(job?.payload)).toContain(second!.token);
    await expect(completeEmailVerification(connection, first!.token, now)).rejects.toBeInstanceOf(
      InvalidEmailVerificationError,
    );
    await completeEmailVerification(connection, second!.token, new Date(now.getTime() + 2_000));
    const [verified] = await connection.db.select().from(user).where(eq(user.id, userId));
    expect(verified?.emailVerified).toBe(true);
    await expect(completeEmailVerification(connection, second!.token, now)).rejects.toBeInstanceOf(
      InvalidEmailVerificationError,
    );
  });

  test("rejects expired and suspended verification without exposing a token", async () => {
    await connection.db.update(user).set({ emailVerified: false }).where(eq(user.id, userId));
    const expired = await requestEmailVerification(
      connection,
      { email, verificationBaseURL: "https://app.test/verify" },
      now,
    );
    await expect(
      completeEmailVerification(
        connection,
        expired!.token,
        new Date(now.getTime() + 24 * 60 * 60 * 1_000),
      ),
    ).rejects.toBeInstanceOf(InvalidEmailVerificationError);
    await connection.db.update(user).set({ status: "suspended" }).where(eq(user.id, userId));
    expect(
      await requestEmailVerification(
        connection,
        { email, verificationBaseURL: "https://app.test/verify" },
        now,
      ),
    ).toBeUndefined();
  });
});
