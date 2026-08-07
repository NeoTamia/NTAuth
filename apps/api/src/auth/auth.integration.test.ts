import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "better-auth/crypto";

import {
  account,
  applyMigrations,
  createDatabase,
  user,
  type DatabaseConnection,
} from "@neotamia/db";

import { createAuth } from "./auth";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const baseURL = "http://localhost/api/auth";
const origin = "http://localhost";

describeWithDatabase("Better Auth persistence", () => {
  let connection: DatabaseConnection;

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 2 });
    await applyMigrations(connection);
  });

  afterAll(async () => {
    await connection.close();
  });

  const auth = () =>
    createAuth({
      baseURL,
      database: connection.db,
      secret: "integration-test-secret-with-at-least-32-characters",
      trustedOrigins: [origin],
    });

  test("rejects public account creation without retaining credentials", async () => {
    const email = `public-signup-${crypto.randomUUID()}@example.test`;
    const password = "Never-log-this-password-123!";
    const response = await auth().handler(
      new Request(`${baseURL}/sign-up/email`, {
        body: JSON.stringify({ email, name: "Public signup", password }),
        headers: { "content-type": "application/json", origin },
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).not.toContain(password);
    const rows = await connection.client`select id from "user" where email = ${email}`;
    expect(rows).toHaveLength(0);
  });

  test("persists a server-provisioned user's session across auth instances", async () => {
    const id = crypto.randomUUID();
    const email = `invited-${id}@example.test`;
    const password = "Invited-user-password-123!";

    await connection.db.insert(user).values({
      email,
      emailVerified: true,
      id,
      name: "Invited user",
    });
    await connection.db.insert(account).values({
      accountId: id,
      id: crypto.randomUUID(),
      password: await hashPassword(password),
      providerId: "credential",
      userId: id,
    });

    try {
      const signIn = await auth().handler(
        new Request(`${baseURL}/sign-in/email`, {
          body: JSON.stringify({ email, password }),
          headers: { "content-type": "application/json", origin },
          method: "POST",
        }),
      );

      expect(signIn.status).toBe(200);
      const cookie = signIn.headers.get("set-cookie");
      expect(cookie).toBeTruthy();

      const persistedSession = await auth().handler(
        new Request(`${baseURL}/get-session`, {
          headers: { cookie: cookie!.split(";")[0]! },
        }),
      );

      expect(persistedSession.status).toBe(200);
      const body = (await persistedSession.json()) as {
        session: { id: string };
        user: { email: string };
      };
      expect(body.user.email).toBe(email);
      expect(body.session.id).toBeTruthy();
    } finally {
      await connection.client`delete from "user" where id = ${id}`;
    }
  });
});
