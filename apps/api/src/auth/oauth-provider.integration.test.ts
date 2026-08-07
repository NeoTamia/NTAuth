import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import {
  applyMigrations,
  auditEvents,
  createDatabase,
  type DatabaseConnection,
} from "@neotamia/db";

import { createAuditedAuthHandler } from "./audited-handler";
import { createAuth } from "./auth";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const baseURL = "http://localhost/api/auth";

describeWithDatabase("OAuth provider integration", () => {
  let connection: DatabaseConnection;
  const runId = crypto.randomUUID();

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 2 });
    await applyMigrations(connection);
  });

  afterAll(async () => {
    await connection.client`delete from audit_events where request_id like ${`${runId}-%`}`;
    await connection.close();
  });

  const handler = () => {
    const auth = createAuth({
      baseURL,
      database: connection.db,
      secret: "oauth-provider-integration-secret-32-characters",
      trustedOrigins: ["http://localhost"],
    });
    return createAuditedAuthHandler(auth, connection);
  };

  test("mounts protocol endpoints on the Drizzle-backed provider", async () => {
    const response = await handler()(
      new Request(`${baseURL}/oauth2/token`, {
        body: new URLSearchParams({ grant_type: "authorization_code" }),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-request-id": `${runId}-token`,
        },
        method: "POST",
      }),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = await response.text();
    expect(body).not.toContain("oauth_clients");
    const [audit] = await connection.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.requestId, `${runId}-token`));
    expect(audit).toMatchObject({ action: "oauth.token", outcome: "denied" });
  });

  test("rejects client credentials and unauthenticated dynamic registration", async () => {
    const token = await handler()(
      new Request(`${baseURL}/oauth2/token`, {
        body: new URLSearchParams({ grant_type: "client_credentials" }),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
      }),
    );
    expect(token.status).toBe(400);
    expect(await token.text()).toContain("unsupported_grant_type");

    const register = await handler()(
      new Request(`${baseURL}/oauth2/register`, {
        body: JSON.stringify({ redirect_uris: ["https://attacker.test/callback"] }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(register.status).toBeGreaterThanOrEqual(400);
  });
});
