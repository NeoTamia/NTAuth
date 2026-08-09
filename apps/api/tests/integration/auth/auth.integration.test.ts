import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import {
  account,
  applyMigrations,
  createDatabase,
  session,
  user,
  type DatabaseConnection,
} from "@neotamia/db";

import { createAuth } from "../../../src/auth/auth";

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

  test("forces hardened cookies for the production boundary", async () => {
    const id = crypto.randomUUID();
    const email = `secure-cookie-${id}@example.test`;
    const password = "Secure-cookie-password-123!";
    await connection.db.insert(user).values({
      email,
      emailVerified: true,
      id,
      name: "Secure cookie user",
    });
    await connection.db.insert(account).values({
      accountId: id,
      id: crypto.randomUUID(),
      password: await hashPassword(password),
      providerId: "credential",
      userId: id,
    });

    try {
      const productionAuth = createAuth({
        baseURL: "https://auth.neotamia.re/api/auth",
        database: connection.db,
        secret: "integration-test-secret-with-at-least-32-characters",
        secureCookies: true,
        trustedOrigins: ["https://auth.neotamia.re"],
      });
      const response = await productionAuth.handler(
        new Request("https://auth.neotamia.re/api/auth/sign-in/email", {
          body: JSON.stringify({ email, password }),
          headers: {
            "content-type": "application/json",
            origin: "https://auth.neotamia.re",
          },
          method: "POST",
        }),
      );
      expect(response.status).toBe(200);
      const cookie = response.headers.get("set-cookie") ?? "";
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
    } finally {
      await connection.client`delete from "user" where id = ${id}`;
    }
  });

  test("lists, minimizes, revokes, and expires persistent sessions immediately", async () => {
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
      const signIn = async () =>
        auth().handler(
          new Request(`${baseURL}/sign-in/email`, {
            body: JSON.stringify({ email, password }),
            headers: {
              "content-type": "application/json",
              origin,
              "user-agent":
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36",
              "x-forwarded-for": "203.0.113.42",
            },
            method: "POST",
          }),
        );
      const firstSignIn = await signIn();
      const secondSignIn = await signIn();

      expect(firstSignIn.status).toBe(200);
      expect(secondSignIn.status).toBe(200);
      const firstCookie = firstSignIn.headers.get("set-cookie")?.split(";")[0];
      const secondCookie = secondSignIn.headers.get("set-cookie")?.split(";")[0];
      expect(firstCookie).toBeTruthy();
      expect(secondCookie).toBeTruthy();

      const getSession = (cookie: string) =>
        auth().handler(new Request(`${baseURL}/get-session`, { headers: { cookie } }));
      const secondSession = await getSession(secondCookie!);
      const secondBody = (await secondSession.json()) as { session: { id: string } };

      const listed = await auth().handler(
        new Request(`${baseURL}/list-sessions`, { headers: { cookie: firstCookie! } }),
      );
      expect(listed.status).toBe(200);
      const sessions = (await listed.json()) as Array<{
        id: string;
        ipAddress: string | null;
        token: string;
        userAgent: string | null;
      }>;
      expect(sessions).toHaveLength(2);
      expect(sessions.every(({ ipAddress }) => ipAddress === null)).toBe(true);
      expect(sessions.every(({ userAgent }) => userAgent === "Chrome")).toBe(true);

      const secondToken = sessions.find(
        ({ id: sessionId }) => sessionId === secondBody.session.id,
      )!.token;
      const revoke = await auth().handler(
        new Request(`${baseURL}/revoke-session`, {
          body: JSON.stringify({ token: secondToken }),
          headers: { "content-type": "application/json", cookie: firstCookie!, origin },
          method: "POST",
        }),
      );
      expect(revoke.status).toBe(200);
      expect(await (await getSession(secondCookie!)).json()).toBeNull();

      const firstBody = (await (await getSession(firstCookie!)).json()) as {
        session: { id: string };
      };
      await connection.client`
        update session set expires_at = now() - interval '1 second' where id = ${firstBody.session.id}
      `;
      expect(await (await getSession(firstCookie!)).json()).toBeNull();
    } finally {
      await connection.client`delete from "user" where id = ${id}`;
    }
  });

  test("refuses to create a session for a suspended identity", async () => {
    const id = crypto.randomUUID();
    const email = `suspended-${id}@example.test`;
    const password = "Suspended-user-password-123!";
    await connection.db.insert(user).values({
      email,
      emailVerified: true,
      id,
      name: "Suspended user",
      status: "suspended",
    });
    await connection.db.insert(account).values({
      accountId: id,
      id: crypto.randomUUID(),
      password: await hashPassword(password),
      providerId: "credential",
      userId: id,
    });

    try {
      const response = await auth().handler(
        new Request(`${baseURL}/sign-in/email`, {
          body: JSON.stringify({ email, password }),
          headers: { "content-type": "application/json", origin },
          method: "POST",
        }),
      );
      expect(response.status).not.toBe(200);
      const sessions = await connection.db.select().from(session).where(eq(session.userId, id));
      expect(sessions).toHaveLength(0);
    } finally {
      await connection.client`delete from "user" where id = ${id}`;
    }
  });

  test("refuses to create a session before email verification", async () => {
    const id = crypto.randomUUID();
    const email = `unverified-${id}@example.test`;
    const password = "Unverified-user-password-123!";
    await connection.db.insert(user).values({ email, id, name: "Unverified user" });
    await connection.db.insert(account).values({
      accountId: id,
      id: crypto.randomUUID(),
      password: await hashPassword(password),
      providerId: "credential",
      userId: id,
    });

    try {
      const response = await auth().handler(
        new Request(`${baseURL}/sign-in/email`, {
          body: JSON.stringify({ email, password }),
          headers: { "content-type": "application/json", origin },
          method: "POST",
        }),
      );
      expect(response.status).not.toBe(200);
      expect(await connection.db.select().from(session).where(eq(session.userId, id))).toHaveLength(
        0,
      );
    } finally {
      await connection.client`delete from "user" where id = ${id}`;
    }
  });
});
