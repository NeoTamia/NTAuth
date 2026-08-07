import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import {
  account,
  applyMigrations,
  auditEvents,
  createDatabase,
  encryptTotpSecret,
  generateTotpCode,
  generateTotpSecret,
  jwks as jwksTable,
  mfaEnrollments,
  oauthClients,
  platformRoleAssignments,
  totpCounter,
  user,
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
  let adminCookie: string;
  const runId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const applicationSecret = "oauth-provider-integration-secret-32-characters";
  const password = "OAuth-registry-admin-password-123!";
  const totpSecret = generateTotpSecret();

  beforeAll(async () => {
    connection = createDatabase(databaseUrl!, { max: 2 });
    await applyMigrations(connection);
    await connection.db.insert(user).values({
      email: `oauth-registry-admin-${runId}@example.test`,
      emailVerified: true,
      id: adminId,
      name: "OAuth registry administrator",
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
    await connection.db.insert(mfaEnrollments).values({
      encryptedSecret: await encryptTotpSecret(totpSecret, applicationSecret),
      lastUsedCounter: totpCounter() - 1,
      userId: adminId,
      verifiedAt: new Date(),
    });
    const signIn = await auth().handler(
      new Request(`${baseURL}/sign-in/email`, {
        body: JSON.stringify({
          email: `oauth-registry-admin-${runId}@example.test`,
          password,
        }),
        headers: { "content-type": "application/json", origin: "http://localhost" },
        method: "POST",
      }),
    );
    adminCookie = signIn.headers.get("set-cookie")!.split(";")[0]!;
  });

  afterAll(async () => {
    await connection.client`delete from audit_events where request_id like ${`${runId}-%`}`;
    await connection.client`delete from jwks where id = ${`expired-${runId}`}`;
    await connection.client`delete from "user" where id = ${adminId}`;
    await connection.close();
  });

  const auth = () =>
    createAuth({
      baseURL,
      connection,
      database: connection.db,
      secret: applicationSecret,
      trustedOrigins: ["http://localhost"],
    });

  const handler = () => {
    return createAuditedAuthHandler(auth(), connection);
  };

  const application = () => {
    const currentAuth = auth();
    return createApp({
      authHandler: createAuditedAuthHandler(currentAuth, connection),
      discoveryRoutes: createDiscoveryRoutes(currentAuth),
    });
  };

  async function privilegedRequest(path: string, init: RequestInit, requestId: string) {
    const counter = totpCounter();
    await connection.db
      .update(mfaEnrollments)
      .set({ lastUsedCounter: counter - 1 })
      .where(eq(mfaEnrollments.userId, adminId));
    const headers = new Headers(init.headers);
    headers.set("cookie", adminCookie);
    headers.set("x-ntauth-totp", await generateTotpCode(totpSecret, counter));
    headers.set("x-request-id", `${runId}-${requestId}`);
    return handler()(new Request(`${baseURL}${path}`, { ...init, headers }));
  }

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

  test("manages confidential clients behind platform-admin MFA without exposing secrets", async () => {
    const denied = await handler()(
      new Request(`${baseURL}/oauth2/create-client`, {
        body: JSON.stringify({ redirect_uris: ["https://client.example/callback"] }),
        headers: { "content-type": "application/json", cookie: adminCookie },
        method: "POST",
      }),
    );
    expect(denied.status).toBe(401);

    const created = await privilegedRequest(
      "/oauth2/create-client",
      {
        body: JSON.stringify({
          client_name: "NTScout integration",
          grant_types: ["authorization_code", "refresh_token"],
          redirect_uris: ["https://client.example/callback"],
          response_types: ["code"],
          scope: "openid profile email offline_access ntscout:access",
          token_endpoint_auth_method: "client_secret_basic",
          type: "web",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
      "client-create",
    );
    expect(created.status).toBe(200);
    expect(created.headers.get("cache-control")).toBe("no-store");
    const registered = (await created.json()) as {
      client_id: string;
      client_secret: string;
      redirect_uris: string[];
    };
    expect(registered.client_secret).toStartWith("ntauth_client_");
    expect(registered.redirect_uris).toEqual(["https://client.example/callback"]);

    const [stored] = await connection.db
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.clientId, registered.client_id));
    expect(stored?.clientSecret).toBeTruthy();
    expect(stored?.clientSecret).not.toBe(registered.client_secret);

    const read = await privilegedRequest(
      `/oauth2/get-client?client_id=${registered.client_id}`,
      { method: "GET" },
      "client-read",
    );
    expect(read.status).toBe(200);
    const readBody = await read.text();
    expect(readBody).not.toContain(registered.client_secret);
    expect(readBody).not.toContain(stored!.clientSecret!);

    const updated = await privilegedRequest(
      "/oauth2/update-client",
      {
        body: JSON.stringify({
          client_id: registered.client_id,
          update: { redirect_uris: ["https://client.example/oauth/callback"] },
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
      "client-update",
    );
    expect(updated.status).toBe(200);
    expect(await updated.text()).not.toContain(registered.client_secret);

    const rotated = await privilegedRequest(
      "/oauth2/client/rotate-secret",
      {
        body: JSON.stringify({ client_id: registered.client_id }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
      "client-rotate",
    );
    expect(rotated.status).toBe(200);
    const rotatedClient = (await rotated.json()) as { client_secret: string };
    expect(rotatedClient.client_secret).toStartWith("ntauth_client_");
    expect(rotatedClient.client_secret).not.toBe(registered.client_secret);

    const deleted = await privilegedRequest(
      "/oauth2/delete-client",
      {
        body: JSON.stringify({ client_id: registered.client_id }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
      "client-delete",
    );
    expect(deleted.status).toBe(200);
    expect(
      await connection.db
        .select()
        .from(oauthClients)
        .where(eq(oauthClients.clientId, registered.client_id)),
    ).toEqual([]);

    const registryAudits = await connection.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorUserId, adminId));
    expect(
      registryAudits
        .filter((event) => event.requestId.startsWith(`${runId}-client-`))
        .map((event) => event.action)
        .toSorted(),
    ).toEqual(
      [
        "oauth.create-client",
        "oauth.delete-client",
        "oauth.get-client",
        "oauth.rotate-secret",
        "oauth.update-client",
      ].toSorted(),
    );
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
