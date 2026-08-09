import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import {
  account,
  applyMigrations,
  createDatabase,
  encryptTotpSecret,
  generateTotpCode,
  generateTotpSecret,
  mfaEnrollments,
  organizationMembers,
  organizations,
  platformRoleAssignments,
  totpCounter,
  user,
  type DatabaseConnection,
} from "@neotamia/db";
import { deleteAuditEventsForTest } from "@neotamia/db/test-support";

import { createApp } from "./app";
import { createAuth } from "./auth/auth";
import { createOrganizationRoutes } from "./organizations";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const origin = "http://localhost:3000";
const baseURL = "http://localhost/api/auth";

describeWithDatabase("organization administration API", () => {
  let app: ReturnType<typeof createApp>;
  let connection: DatabaseConnection;
  let cookie: string;
  let code: string;
  let counter: number;
  const applicationSecret = "organization-api-test-secret-32-characters";
  const runId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const password = "Organization-admin-password-123!";

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 2 });
    await applyMigrations(connection);
    await connection.db.insert(user).values([
      {
        email: `organization-api-admin-${runId}@example.test`,
        emailVerified: true,
        id: adminId,
        name: "Organization API admin",
      },
      {
        email: `organization-api-member-${runId}@example.test`,
        emailVerified: true,
        id: memberId,
        name: "Organization API member",
      },
    ]);
    await connection.db.insert(account).values({
      accountId: adminId,
      id: crypto.randomUUID(),
      password: await hashPassword(password),
      providerId: "credential",
      userId: adminId,
    });
    await connection.db.insert(platformRoleAssignments).values({
      role: "platform_admin",
      userId: adminId,
    });
    await connection.db.insert(organizations).values({
      id: organizationId,
      name: "Organization API",
      slug: `organization-api-${runId}`,
    });
    await connection.db.insert(organizationMembers).values([
      { organizationId, role: "owner", userId: adminId },
      { organizationId, role: "member", userId: memberId },
    ]);
    const secret = generateTotpSecret();
    counter = totpCounter();
    code = await generateTotpCode(secret, counter);
    await connection.db.insert(mfaEnrollments).values({
      encryptedSecret: await encryptTotpSecret(secret, applicationSecret),
      lastUsedCounter: counter - 1,
      userId: adminId,
      verifiedAt: new Date(),
    });
    const auth = createAuth({
      baseURL,
      database: connection.db,
      secret: "organization-auth-test-secret-32-characters",
      trustedOrigins: [origin],
    });
    app = createApp({
      authHandler: auth.handler,
      organizationRoutes: createOrganizationRoutes({
        applicationSecret,
        auth,
        database: connection,
      }),
    });
    const signIn = await app.handle(
      new Request(`${baseURL}/sign-in/email`, {
        body: JSON.stringify({
          email: `organization-api-admin-${runId}@example.test`,
          password,
        }),
        headers: { "content-type": "application/json", origin },
        method: "POST",
      }),
    );
    cookie = signIn.headers.get("set-cookie")!.split(";")[0]!;
  });

  afterAll(async () => {
    await deleteAuditEventsForTest(connection, { requestIdPrefixes: [`${runId}-`] });
    await connection.db.delete(organizations).where(eq(organizations.id, organizationId));
    await connection.db.delete(user).where(eq(user.id, adminId));
    await connection.db.delete(user).where(eq(user.id, memberId));
    await connection.close();
  });

  async function headers(requestId: string) {
    await connection.db
      .update(mfaEnrollments)
      .set({ lastUsedCounter: counter - 1 })
      .where(eq(mfaEnrollments.userId, adminId));
    return { cookie, "x-ntauth-totp": code, "x-request-id": `${runId}-${requestId}` };
  }

  test("requires MFA and returns only server-authorized administration data", async () => {
    const denied = await app.handle(
      new Request("http://localhost/api/v1/organizations", { headers: { cookie } }),
    );
    expect(denied.status).toBe(403);

    const listed = await app.handle(
      new Request("http://localhost/api/v1/organizations", { headers: await headers("list") }),
    );
    expect(listed.status).toBe(200);
    expect(await listed.json()).toContainEqual(
      expect.objectContaining({ id: organizationId, memberCount: 2 }),
    );

    const detail = await app.handle(
      new Request(`http://localhost/api/v1/organizations/${organizationId}`, {
        headers: await headers("detail"),
      }),
    );
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      invitations: [],
      members: expect.arrayContaining([
        expect.objectContaining({ role: "owner", userId: adminId }),
      ]),
      organization: { id: organizationId },
    });
  });

  test("maps the locked last-administrator guard to a recoverable conflict", async () => {
    const response = await app.handle(
      new Request(`http://localhost/api/v1/organizations/${organizationId}/members/${adminId}`, {
        body: JSON.stringify({ role: "member", status: "active" }),
        headers: {
          ...(await headers("last-administrator")),
          "content-type": "application/json",
          origin,
        },
        method: "PATCH",
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "organization_conflict" });
  });
});
