import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "better-auth/crypto";

import {
  account,
  applyMigrations,
  createDatabase,
  encryptTotpSecret,
  generateTotpCode,
  generateTotpSecret,
  mfaEnrollments,
  platformRoleAssignments,
  totpCounter,
  user,
  type DatabaseConnection,
} from "@neotamia/db";

import { createApp } from "./app";
import { createAuth } from "./auth/auth";
import { createInvitationRoutes } from "./invitations";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const origin = "http://localhost:3000";
const baseURL = "http://localhost:3001/api/auth";

describeWithDatabase("invitation API", () => {
  let connection: DatabaseConnection;
  const runId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const password = "Platform-admin-password-123!";
  let organizationId: string;
  let totpCode: string;
  let app: ReturnType<typeof createApp>;
  let cookie: string;

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 2 });
    await applyMigrations(connection);
    await connection.db.insert(user).values({
      email: `api-admin-${runId}@example.test`,
      emailVerified: true,
      id: adminId,
      name: "API admin",
    });
    await connection.db.insert(account).values({
      accountId: adminId,
      id: crypto.randomUUID(),
      password: await hashPassword(password),
      providerId: "credential",
      userId: adminId,
    });
    await connection.db
      .insert(platformRoleAssignments)
      .values({ role: "platform_admin", userId: adminId });
    const [organization] = await connection.client<{ id: string }[]>`
      insert into organizations (name, slug) values ('API Test', ${`api-${runId}`}) returning id
    `;
    organizationId = organization!.id;

    const auth = createAuth({
      baseURL,
      database: connection.db,
      secret: "invitation-api-test-secret-at-least-32-characters",
      trustedOrigins: [origin],
    });
    app = createApp({
      authHandler: auth.handler,
      invitationRoutes: createInvitationRoutes({
        acceptInvitationURL: `${origin}/auth/accept-invitation`,
        applicationSecret: "integration-test-secret-with-at-least-32-characters",
        auth,
        database: connection,
      }),
    });
    const signIn = await app.handle(
      new Request(`${baseURL}/sign-in/email`, {
        body: JSON.stringify({ email: `api-admin-${runId}@example.test`, password }),
        headers: { "content-type": "application/json", origin },
        method: "POST",
      }),
    );
    cookie = signIn.headers.get("set-cookie")!.split(";")[0]!;
    const secret = generateTotpSecret();
    const counter = totpCounter();
    totpCode = await generateTotpCode(secret, counter);
    await connection.db.insert(mfaEnrollments).values({
      encryptedSecret: await encryptTotpSecret(
        secret,
        "integration-test-secret-with-at-least-32-characters",
      ),
      lastUsedCounter: counter - 1,
      userId: adminId,
      verifiedAt: new Date(),
    });
  });

  afterAll(async () => {
    await connection.client`delete from jobs where deduplication_key like 'invitation:%'`;
    await connection.client`delete from audit_events where request_id like ${`${runId}%`} or request_id like 'invitation:%'`;
    await connection.client`delete from organizations where id = ${organizationId}`;
    await connection.client`delete from "user" where id = ${adminId} or email = ${`api-invited-${runId}@example.test`}`;
    await connection.close();
  });

  test("requires authentication and exposes no invitation token in the create response", async () => {
    const request = (headers: HeadersInit) =>
      app.handle(
        new Request("http://localhost/api/v1/invitations", {
          body: JSON.stringify({
            email: `api-invited-${runId}@example.test`,
            organizationId,
            role: "member",
          }),
          headers: { "content-type": "application/json", origin, ...headers },
          method: "POST",
        }),
      );
    expect((await request({})).status).toBe(401);

    const created = await request({
      cookie,
      "x-ntauth-totp": totpCode,
      "x-request-id": `${runId}-create`,
    });
    expect(created.status).toBe(201);
    const body = await created.text();
    expect(body).not.toContain("token");

    const [job] = await connection.client<{ payload: { text: string } }[]>`
      select payload from jobs where deduplication_key = ${`invitation:${JSON.parse(body).id}`}
    `;
    const token = new URL(
      job!.payload.text.replace("Accept your invitation: ", ""),
    ).searchParams.get("token")!;
    const accept = () =>
      app.handle(
        new Request("http://localhost/api/v1/invitations/accept", {
          body: JSON.stringify({ name: "API invited", password: "Invited-password-123!", token }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
    expect((await accept()).status).toBe(200);
    const reused = await accept();
    expect(reused.status).toBe(400);
    expect(reused.headers.get("content-type")).toContain("application/problem+json");
  });
});
