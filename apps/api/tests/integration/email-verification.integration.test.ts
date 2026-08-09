import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { applyMigrations, createDatabase, user, type DatabaseConnection } from "@neotamia/db";
import { deleteAuditEventsForTest } from "@neotamia/db/test-support";

import { createApp } from "@/app";
import { createEmailVerificationRoutes } from "@/email-verification";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("email verification API", () => {
  let connection: DatabaseConnection;
  const runId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const email = `api-verify-${runId}@example.test`;

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 2 });
    await applyMigrations(connection);
    await connection.db.insert(user).values({ email, id: userId, name: "API unverified" });
  });

  afterAll(async () => {
    await connection.client`delete from jobs where payload->>'to' = ${email}`;
    await deleteAuditEventsForTest(connection, { resourceId: userId });
    await connection.client`delete from "user" where id = ${userId}`;
    await connection.close();
  });

  const app = () =>
    createApp({
      emailVerificationRoutes: createEmailVerificationRoutes({
        database: connection,
        verificationURL: "http://localhost/auth/verify-email",
      }),
    });

  test("keeps resend enumeration-safe and verifies once", async () => {
    const request = (address: string) =>
      app().handle(
        new Request("http://localhost/api/v1/email-verification/request", {
          body: JSON.stringify({ email: address }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
    const known = await request(email);
    const unknown = await request(`unknown-${runId}@example.test`);
    expect(known.status).toBe(202);
    expect(await known.text()).toBe(await unknown.text());

    const [job] = await connection.client<{ payload: { text: string } }[]>`
      select payload from jobs where payload->>'to' = ${email} order by created_at desc limit 1
    `;
    const token = new URL(job!.payload.text.replace("Verify your email: ", "")).searchParams.get(
      "token",
    )!;
    const verify = () =>
      app().handle(
        new Request("http://localhost/api/v1/email-verification/verify", {
          body: JSON.stringify({ token }),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      );
    expect((await verify()).status).toBe(200);
    const reused = await verify();
    expect(reused.status).toBe(400);
    expect(reused.headers.get("content-type")).toContain("application/problem+json");
  });
});
