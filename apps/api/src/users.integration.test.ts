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
import { createMfaRoutes } from "./mfa";
import { createPasswordRoutes } from "./passwords";
import { createUserRoutes } from "./users";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const baseURL = "http://localhost/api/auth";
const origin = "http://localhost";

describeWithDatabase("user lifecycle API", () => {
  let connection: DatabaseConnection;
  let cookie: string;
  const runId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const targetId = crypto.randomUUID();
  const applicationSecret = "integration-test-secret-with-at-least-32-characters";
  const password = "Lifecycle-admin-password-123!";

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 2 });
    await applyMigrations(connection);
    await connection.db.insert(user).values([
      {
        email: `api-lifecycle-admin-${runId}@example.test`,
        emailVerified: true,
        id: adminId,
        name: "Admin",
      },
      {
        email: `api-lifecycle-target-${runId}@example.test`,
        emailVerified: true,
        id: targetId,
        name: "Target",
      },
    ]);
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

    const response = await auth().handler(
      new Request(`${baseURL}/sign-in/email`, {
        body: JSON.stringify({ email: `api-lifecycle-admin-${runId}@example.test`, password }),
        headers: { "content-type": "application/json", origin },
        method: "POST",
      }),
    );
    cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  });

  afterAll(async () => {
    await connection.client`delete from audit_events where request_id like ${`${runId}-%`}`;
    await connection.client`delete from "user" where id in (${adminId}, ${targetId})`;
    await connection.close();
  });

  const auth = () =>
    createAuth({
      baseURL,
      database: connection.db,
      secret: "integration-test-secret-with-at-least-32-characters",
      trustedOrigins: [origin],
    });

  const app = () => {
    const currentAuth = auth();
    return createApp({
      passwordRoutes: createPasswordRoutes({
        auth: currentAuth,
        database: connection,
        resetPasswordURL: `${origin}/auth/reset-password`,
      }),
      mfaRoutes: createMfaRoutes({ applicationSecret, auth: currentAuth, database: connection }),
      userRoutes: createUserRoutes({
        applicationSecret,
        auth: currentAuth,
        database: connection,
      }),
    });
  };

  test("requires authentication for status changes", async () => {
    const response = await app().handle(
      new Request(`http://localhost/api/v1/users/${targetId}/status`, {
        body: JSON.stringify({ status: "suspended" }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  test("keeps forgot-password enumeration-safe and protects authenticated changes", async () => {
    const forgot = (email: string) =>
      app().handle(
        new Request("http://localhost/api/v1/password/forgot", {
          body: JSON.stringify({ email }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
    const known = await forgot(`api-lifecycle-target-${runId}@example.test`);
    const unknown = await forgot(`missing-${runId}@example.test`);
    expect(known.status).toBe(202);
    expect(await known.text()).toBe(await unknown.text());

    const change = await app().handle(
      new Request("http://localhost/api/v1/password/change", {
        body: JSON.stringify({ currentPassword: "anything", password: "Valid-password-123!" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(change.status).toBe(401);
  });

  test("requires an enrolled, non-replayed TOTP for a platform action", async () => {
    const secret = generateTotpSecret();
    const counter = totpCounter();
    const code = await generateTotpCode(secret, counter);
    await connection.db.insert(mfaEnrollments).values({
      encryptedSecret: await encryptTotpSecret(secret, applicationSecret),
      lastUsedCounter: counter - 1,
      userId: adminId,
      verifiedAt: new Date(),
    });
    const changeStatus = () =>
      app().handle(
        new Request(`http://localhost/api/v1/users/${targetId}/status`, {
          body: JSON.stringify({ status: "suspended" }),
          headers: {
            "content-type": "application/json",
            cookie,
            "x-ntauth-totp": code,
            "x-request-id": `${runId}-suspend`,
          },
          method: "PATCH",
        }),
      );
    expect((await changeStatus()).status).toBe(200);
    expect((await changeStatus()).status).toBe(403);
  });

  test("enrolls and verifies TOTP through the authenticated API", async () => {
    const enrolled = await app().handle(
      new Request("http://localhost/api/v1/mfa/enroll", {
        body: JSON.stringify({ password }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }),
    );
    expect(enrolled.status).toBe(200);
    const { totpURI } = (await enrolled.json()) as { totpURI: string };
    const secret = new URL(totpURI).searchParams.get("secret")!;
    const code = await generateTotpCode(secret, totpCounter());
    const verified = await app().handle(
      new Request("http://localhost/api/v1/mfa/verify", {
        body: JSON.stringify({ code }),
        headers: {
          "content-type": "application/json",
          cookie,
          "x-request-id": `${runId}-mfa-verify`,
        },
        method: "POST",
      }),
    );
    expect(verified.status).toBe(200);
  });
});
