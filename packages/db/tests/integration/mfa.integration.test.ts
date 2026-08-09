import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "../../src/client";
import { deleteAuditEventsForTest } from "../../src/test-support";
import {
  beginMfaEnrollment,
  enforcePlatformAdminMfa,
  generateTotpCode,
  InvalidMfaChallengeError,
  MfaEnrollmentAuthorizationError,
  MfaEnrollmentRequiredError,
  totpCounter,
  verifyMfaEnrollment,
} from "../../src/mfa";
import { applyMigrations } from "../../src/migrations";
import { mfaEnrollments, platformRoleAssignments, user } from "../../src/schema";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("administrator TOTP step-up", () => {
  let connection: DatabaseConnection;
  const runId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const applicationSecret = "integration-mfa-encryption-key-with-32-characters";
  const now = new Date("2026-08-08T12:00:00.000Z");

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 2 });
    await applyMigrations(connection);
    await connection.db.insert(user).values([
      { email: `mfa-admin-${runId}@example.test`, id: adminId, name: "MFA admin" },
      { email: `mfa-member-${runId}@example.test`, id: memberId, name: "Member" },
    ]);
    await connection.db
      .insert(platformRoleAssignments)
      .values({ role: "platform_admin", userId: adminId });
  });

  afterAll(async () => {
    await deleteAuditEventsForTest(connection, { actorUserIds: [adminId, memberId] });
    await connection.client`delete from "user" where id in (${adminId}, ${memberId})`;
    await connection.close();
  });

  test("requires enrollment before privileged actions and stores an encrypted secret", async () => {
    await expect(
      enforcePlatformAdminMfa(
        connection,
        { applicationSecret, requestId: `${runId}-missing`, userId: adminId },
        now,
      ),
    ).rejects.toBeInstanceOf(MfaEnrollmentRequiredError);
    const enrollment = await beginMfaEnrollment(
      connection,
      { applicationSecret, issuer: "NTAuth", userId: adminId },
      now,
    );
    const secret = new URL(enrollment.totpURI).searchParams.get("secret")!;
    const [stored] = await connection.db
      .select()
      .from(mfaEnrollments)
      .where(eq(mfaEnrollments.userId, adminId));
    expect(stored?.encryptedSecret).not.toContain(secret);
    expect(stored?.encryptedSecret.startsWith("v1:")).toBe(true);
  });

  test("rejects expired enrollment codes and consumes valid counters exactly once", async () => {
    const enrollment = await beginMfaEnrollment(
      connection,
      { applicationSecret, issuer: "NTAuth", userId: adminId },
      now,
    );
    const secret = new URL(enrollment.totpURI).searchParams.get("secret")!;
    const expired = await generateTotpCode(secret, totpCounter(now) - 2);
    await expect(
      verifyMfaEnrollment(
        connection,
        { applicationSecret, code: expired, requestId: `${runId}-expired`, userId: adminId },
        now,
      ),
    ).rejects.toBeInstanceOf(InvalidMfaChallengeError);

    const enrollmentCode = await generateTotpCode(secret, totpCounter(now));
    await verifyMfaEnrollment(
      connection,
      { applicationSecret, code: enrollmentCode, requestId: `${runId}-enroll`, userId: adminId },
      now,
    );
    await expect(
      enforcePlatformAdminMfa(
        connection,
        {
          applicationSecret,
          code: enrollmentCode,
          requestId: `${runId}-enroll-reuse`,
          userId: adminId,
        },
        now,
      ),
    ).rejects.toBeInstanceOf(InvalidMfaChallengeError);

    const next = new Date(now.getTime() + 30_000);
    const actionCode = await generateTotpCode(secret, totpCounter(next));
    await expect(
      enforcePlatformAdminMfa(
        connection,
        { applicationSecret, code: actionCode, requestId: `${runId}-action`, userId: adminId },
        next,
      ),
    ).resolves.toBe("verified");
    await expect(
      enforcePlatformAdminMfa(
        connection,
        { applicationSecret, code: actionCode, requestId: `${runId}-replay`, userId: adminId },
        next,
      ),
    ).rejects.toBeInstanceOf(InvalidMfaChallengeError);
  });

  test("does not require platform MFA from a non-platform member and rejects suspended enrollment", async () => {
    await expect(
      enforcePlatformAdminMfa(
        connection,
        { applicationSecret, requestId: `${runId}-member`, userId: memberId },
        now,
      ),
    ).resolves.toBe("not_required");
    await connection.db.update(user).set({ status: "suspended" }).where(eq(user.id, adminId));
    await expect(
      beginMfaEnrollment(connection, { applicationSecret, issuer: "NTAuth", userId: adminId }, now),
    ).rejects.toBeInstanceOf(MfaEnrollmentAuthorizationError);
    await connection.db.update(user).set({ status: "active" }).where(eq(user.id, adminId));
  });
});
