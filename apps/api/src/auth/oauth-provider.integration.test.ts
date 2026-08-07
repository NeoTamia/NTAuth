import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import {
  applyMigrations,
  auditEvents,
  createDatabase,
  jwks as jwksTable,
  type DatabaseConnection,
} from "@neotamia/db";

import { createAuditedAuthHandler } from "./audited-handler";
import { createAuth } from "./auth";
import { createDiscoveryRoutes } from "./discovery";
import { createApp } from "../app";

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
    await connection.client`delete from jwks where id = ${`expired-${runId}`}`;
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

  const application = () => {
    const auth = createAuth({
      baseURL,
      database: connection.db,
      secret: "oauth-provider-integration-secret-32-characters",
      trustedOrigins: ["http://localhost"],
    });
    return createApp({
      authHandler: createAuditedAuthHandler(auth, connection),
      discoveryRoutes: createDiscoveryRoutes(auth),
    });
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

  test("publishes strict root discovery and cacheable public JWKS", async () => {
    const app = application();
    const discovery = await app.handle(
      new Request("http://localhost/.well-known/openid-configuration"),
    );
    expect(discovery.status).toBe(200);
    expect(discovery.headers.get("cache-control")).toContain("max-age=300");
    const metadata = (await discovery.json()) as Record<string, unknown>;
    expect(metadata.issuer).toBe(baseURL);
    expect(metadata.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
    expect(metadata).not.toHaveProperty("registration_endpoint");

    const initialJwks = await app.handle(new Request(`${baseURL}/jwks`));
    expect(initialJwks.status).toBe(200);
    const [activeKey] = await connection.db.select().from(jwksTable).limit(1);
    await connection.db.insert(jwksTable).values({
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
      expiresAt: new Date("2020-01-02T00:00:00.000Z"),
      id: `expired-${runId}`,
      privateKey: activeKey!.privateKey,
      publicKey: activeKey!.publicKey,
    });
    const jwks = await app.handle(new Request(`${baseURL}/jwks`));
    const etag = jwks.headers.get("etag")!;
    const keys = (await jwks.json()) as { keys: Array<Record<string, unknown>> };
    expect(keys.keys.length).toBeGreaterThan(0);
    expect(keys.keys.every((key) => key.alg === "ES256" && !Object.hasOwn(key, "d"))).toBe(true);
    expect(keys.keys.some((key) => key.kid === `expired-${runId}`)).toBe(false);
    const cached = await app.handle(
      new Request(`${baseURL}/jwks`, { headers: { "if-none-match": etag } }),
    );
    expect(cached.status).toBe(304);
  });
});
