import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "better-auth/crypto";

import {
  account,
  applyMigrations,
  createDatabase,
  platformRoleAssignments,
  user,
  type DatabaseConnection,
} from "@neotamia/db";

import { createApp } from "./app";
import { createAuth } from "./auth/auth";
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

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 2 });
    await applyMigrations(connection);
    const password = "Lifecycle-admin-password-123!";
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
      userRoutes: createUserRoutes({ auth: currentAuth, database: connection }),
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

  test("suspends, reactivates, deletes, and rejects reuse", async () => {
    const changeStatus = (status: string) =>
      app().handle(
        new Request(`http://localhost/api/v1/users/${targetId}/status`, {
          body: JSON.stringify({ status }),
          headers: {
            "content-type": "application/json",
            cookie,
            "x-request-id": `${runId}-${status}`,
          },
          method: "PATCH",
        }),
      );
    expect((await changeStatus("suspended")).status).toBe(200);
    expect((await changeStatus("active")).status).toBe(200);
    expect((await changeStatus("deactivated")).status).toBe(200);
    expect((await changeStatus("active")).status).toBe(200);

    const removed = await app().handle(
      new Request(`http://localhost/api/v1/users/${targetId}`, {
        headers: { cookie, "x-request-id": `${runId}-delete` },
        method: "DELETE",
      }),
    );
    expect(removed.status).toBe(204);
    const reused = await changeStatus("active");
    expect(reused.status).toBe(409);
    expect(reused.headers.get("content-type")).toContain("application/problem+json");
  });
});
