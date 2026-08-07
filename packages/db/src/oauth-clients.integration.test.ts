import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "./client";
import { applyMigrations } from "./migrations";
import { NTSCOUT_CLIENT_ID, NTSCOUT_SCOPES, provisionNtscoutClient } from "./oauth-clients";
import { auditEvents, oauthClients } from "./schema";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("NTScout OAuth client provisioning", () => {
  let connection: DatabaseConnection;
  const runId = crypto.randomUUID();

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 1 });
    await applyMigrations(connection);
    await connection.db.delete(oauthClients).where(eq(oauthClients.clientId, NTSCOUT_CLIENT_ID));
  });

  afterAll(async () => {
    await connection.db.delete(oauthClients).where(eq(oauthClients.clientId, NTSCOUT_CLIENT_ID));
    await connection.client`delete from audit_events where request_id like ${`${runId}-%`}`;
    await connection.close();
  });

  test("creates and reconciles one public client without a secret", async () => {
    const initialTime = new Date("2026-01-01T00:00:00.000Z");
    const initial = await provisionNtscoutClient(
      connection,
      {
        NTSCOUT_ENVIRONMENT: "development",
        NTSCOUT_REDIRECT_URIS: ["http://127.0.0.1:3003/auth/callback"],
        requestId: `${runId}-initial`,
      },
      initialTime,
    );
    expect(initial).toMatchObject({
      clientId: NTSCOUT_CLIENT_ID,
      clientSecret: null,
      disabled: false,
      enableEndSession: true,
      grantTypes: ["authorization_code", "refresh_token"],
      public: true,
      redirectUris: ["http://127.0.0.1:3003/auth/callback"],
      requirePKCE: true,
      responseTypes: ["code"],
      scopes: [...NTSCOUT_SCOPES],
      skipConsent: false,
      tokenEndpointAuthMethod: "none",
      type: "user-agent-based",
    });

    const reconciledTime = new Date("2026-01-02T00:00:00.000Z");
    await provisionNtscoutClient(
      connection,
      {
        NTSCOUT_ENVIRONMENT: "staging",
        NTSCOUT_REDIRECT_URIS: ["https://staging.ntscout.example/auth/callback"],
        requestId: `${runId}-reconciled`,
      },
      reconciledTime,
    );
    const stored = await connection.db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.clientId, NTSCOUT_CLIENT_ID));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      clientSecret: null,
      metadata: { environment: "staging", managedBy: "ntauth-seed" },
      redirectUris: ["https://staging.ntscout.example/auth/callback"],
      updatedAt: reconciledTime,
    });

    const audits = await connection.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.resourceId, NTSCOUT_CLIENT_ID));
    expect(
      audits
        .filter((event) => event.requestId.startsWith(runId))
        .map((event) => ({
          action: event.action,
          metadata: event.metadata,
          outcome: event.outcome,
        })),
    ).toEqual([
      {
        action: "oauth.client.seed",
        metadata: { environment: "development", redirectUriCount: 1 },
        outcome: "success",
      },
      {
        action: "oauth.client.seed",
        metadata: { environment: "staging", redirectUriCount: 1 },
        outcome: "success",
      },
    ]);
  });
});
