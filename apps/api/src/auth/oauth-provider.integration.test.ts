import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "better-auth/crypto";
import { desc, eq } from "drizzle-orm";

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
  NTSCOUT_CLIENT_ID,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  organizationMembers,
  organizations,
  platformRoleAssignments,
  provisionNtscoutClient,
  totpCounter,
  user,
  verification,
  type DatabaseConnection,
} from "@neotamia/db";

import { createAuditedAuthHandler } from "./audited-handler";
import { createAuth } from "./auth";
import { createDiscoveryRoutes } from "./discovery";
import { createApp } from "../app";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const baseURL = "http://localhost/api/auth";

async function pkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return Buffer.from(digest).toString("base64url");
}

describeWithDatabase("OAuth provider integration", () => {
  let connection: DatabaseConnection;
  let adminCookie: string;
  const runId = crypto.randomUUID();
  const adminId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
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
    await connection.db.insert(organizations).values({
      id: organizationId,
      name: "OAuth integration organization",
      slug: `oauth-${runId}`,
    });
    await connection.db.insert(organizationMembers).values({
      organizationId,
      role: "owner",
      userId: adminId,
    });
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
    await connection.db.delete(oauthClients).where(eq(oauthClients.clientId, NTSCOUT_CLIENT_ID));
    await connection.client`delete from "user" where id = ${adminId}`;
    await connection.db.delete(organizations).where(eq(organizations.id, organizationId));
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

  async function authorizePublicClient(input: {
    clientId: string;
    nonce: string;
    redirectUri: string;
    requestId: string;
    scope?: string;
    state: string;
    verifier: string;
  }) {
    const query = new URLSearchParams({
      client_id: input.clientId,
      code_challenge: await pkceChallenge(input.verifier),
      code_challenge_method: "S256",
      nonce: input.nonce,
      organization_id: organizationId,
      redirect_uri: input.redirectUri,
      response_type: "code",
      scope: input.scope ?? "openid profile",
      state: input.state,
    });
    const response = await handler()(
      new Request(`${baseURL}/oauth2/authorize?${query}`, {
        headers: {
          accept: "application/json",
          cookie: adminCookie,
          "x-request-id": `${runId}-${input.requestId}`,
        },
      }),
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { redirect: boolean; url: string };
    expect(payload.redirect).toBe(true);
    return new URL(payload.url);
  }

  const exchangeCode = (input: {
    clientId: string;
    code: string;
    redirectUri: string;
    requestId: string;
    verifier: string;
  }) =>
    handler()(
      new Request(`${baseURL}/oauth2/token`, {
        body: new URLSearchParams({
          client_id: input.clientId,
          code: input.code,
          code_verifier: input.verifier,
          grant_type: "authorization_code",
          redirect_uri: input.redirectUri,
        }),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-request-id": `${runId}-${input.requestId}`,
        },
        method: "POST",
      }),
    );

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

  test("enforces one-time Authorization Code with exact redirect URI and PKCE S256", async () => {
    const redirectUri = "https://public-client.example/callback";
    const created = await privilegedRequest(
      "/oauth2/create-client",
      {
        body: JSON.stringify({
          client_name: "Public PKCE client",
          grant_types: ["authorization_code"],
          redirect_uris: [redirectUri],
          response_types: ["code"],
          scope: "openid profile",
          token_endpoint_auth_method: "none",
          type: "native",
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
      "flow-client-create",
    );
    expect(created.status).toBe(200);
    const publicClient = (await created.json()) as {
      client_id: string;
      client_secret?: string;
    };
    expect(publicClient.client_secret).toBeUndefined();
    await connection.db.insert(oauthConsents).values({
      clientId: publicClient.client_id,
      id: crypto.randomUUID(),
      referenceId: organizationId,
      scopes: ["openid", "profile"],
      userId: adminId,
    });

    const alteredOrganization = new URLSearchParams({
      client_id: publicClient.client_id,
      code_challenge: await pkceChallenge("altered-organization-verifier-1234567890123456789012"),
      code_challenge_method: "S256",
      nonce: "nonce-altered-organization",
      organization_id: crypto.randomUUID(),
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid profile",
      state: "state-altered-organization",
    });
    const rejectedOrganization = await handler()(
      new Request(`${baseURL}/oauth2/authorize?${alteredOrganization}`, {
        headers: {
          accept: "application/json",
          cookie: adminCookie,
          "x-request-id": `${runId}-flow-authorize-altered-organization`,
        },
      }),
    );
    expect(rejectedOrganization.status).toBe(400);
    expect(await rejectedOrganization.json()).toEqual({
      error: "invalid_request",
      error_description: "organization context is invalid",
    });

    const disallowedScope = new URLSearchParams({
      client_id: publicClient.client_id,
      code_challenge: await pkceChallenge("disallowed-scope-verifier-123456789012345678901234"),
      code_challenge_method: "S256",
      nonce: "nonce-disallowed-scope",
      organization_id: organizationId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email",
      state: "state-disallowed-scope",
    });
    const rejectedScope = await handler()(
      new Request(`${baseURL}/oauth2/authorize?${disallowedScope}`, {
        headers: {
          accept: "application/json",
          cookie: adminCookie,
          "x-request-id": `${runId}-flow-authorize-disallowed-scope`,
        },
      }),
    );
    expect(rejectedScope.status).toBe(200);
    const rejectedScopeBody = (await rejectedScope.json()) as { url: string };
    expect(new URL(rejectedScopeBody.url).searchParams.get("error")).toBe("invalid_scope");

    const withoutPkce = new URLSearchParams({
      client_id: publicClient.client_id,
      nonce: "nonce-missing-pkce",
      organization_id: organizationId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid profile",
      state: "state-missing-pkce",
    });
    const missingPkce = await handler()(
      new Request(`${baseURL}/oauth2/authorize?${withoutPkce}`, {
        headers: {
          accept: "application/json",
          cookie: adminCookie,
          "x-request-id": `${runId}-flow-authorize-missing-pkce`,
        },
      }),
    );
    const missingPkceBody = (await missingPkce.json()) as { url: string };
    expect(new URL(missingPkceBody.url).searchParams.get("error")).toBe("invalid_request");

    const mismatchedRedirect = await authorizePublicClient({
      clientId: publicClient.client_id,
      nonce: "nonce-wrong-redirect",
      redirectUri: `${redirectUri}/extra`,
      requestId: "flow-authorize-wrong-redirect",
      state: "state-wrong-redirect",
      verifier: "wrong-redirect-verifier-that-is-long-enough-1234567890",
    });
    expect(mismatchedRedirect.origin + mismatchedRedirect.pathname).toBe(`${baseURL}/error`);
    expect(mismatchedRedirect.searchParams.get("error")).toBe("invalid_redirect");
    expect(mismatchedRedirect.searchParams.has("code")).toBe(false);

    const plainPkce = new URLSearchParams({
      client_id: publicClient.client_id,
      code_challenge: "plain-verifier",
      code_challenge_method: "plain",
      nonce: "nonce-plain-pkce",
      organization_id: organizationId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid profile",
      state: "state-plain-pkce",
    });
    const rejectedPlain = await handler()(
      new Request(`${baseURL}/oauth2/authorize?${plainPkce}`, {
        headers: {
          accept: "application/json",
          cookie: adminCookie,
          "x-request-id": `${runId}-flow-authorize-plain-pkce`,
        },
      }),
    );
    expect(rejectedPlain.status).toBe(400);

    const wrongVerifier = "correct-verifier-for-negative-flow-12345678901234567890";
    const wrongVerifierAuthorization = await authorizePublicClient({
      clientId: publicClient.client_id,
      nonce: "nonce-wrong-verifier",
      redirectUri,
      requestId: "flow-authorize-wrong-verifier",
      state: "state-wrong-verifier",
      verifier: wrongVerifier,
    });
    const wrongVerifierCode = wrongVerifierAuthorization.searchParams.get("code")!;
    const rejectedVerifier = await exchangeCode({
      clientId: publicClient.client_id,
      code: wrongVerifierCode,
      redirectUri,
      requestId: "flow-token-wrong-verifier",
      verifier: "different-verifier-for-negative-flow-123456789012345",
    });
    expect(rejectedVerifier.status).toBe(401);
    expect(await rejectedVerifier.text()).toContain("code verification failed");
    const consumedAfterMismatch = await exchangeCode({
      clientId: publicClient.client_id,
      code: wrongVerifierCode,
      redirectUri,
      requestId: "flow-token-consumed-after-mismatch",
      verifier: wrongVerifier,
    });
    expect(consumedAfterMismatch.status).toBe(401);
    expect(await consumedAfterMismatch.text()).toContain("invalid_grant");

    const redirectVerifier = "redirect-mismatch-verifier-123456789012345678901234";
    const redirectAuthorization = await authorizePublicClient({
      clientId: publicClient.client_id,
      nonce: "nonce-token-redirect",
      redirectUri,
      requestId: "flow-authorize-token-redirect",
      state: "state-token-redirect",
      verifier: redirectVerifier,
    });
    const rejectedRedirect = await exchangeCode({
      clientId: publicClient.client_id,
      code: redirectAuthorization.searchParams.get("code")!,
      redirectUri: "https://public-client.example/other-callback",
      requestId: "flow-token-wrong-redirect",
      verifier: redirectVerifier,
    });
    expect(rejectedRedirect.status).toBe(400);
    expect(await rejectedRedirect.text()).toContain("redirect_uri mismatch");

    const expiringVerifier = "expiring-verifier-123456789012345678901234567890";
    const expiringAuthorization = await authorizePublicClient({
      clientId: publicClient.client_id,
      nonce: "nonce-expiring-code",
      redirectUri,
      requestId: "flow-authorize-expiring",
      state: "state-expiring-code",
      verifier: expiringVerifier,
    });
    const [storedCode] = await connection.db
      .select()
      .from(verification)
      .orderBy(desc(verification.createdAt))
      .limit(1);
    expect(storedCode!.expiresAt.getTime() - storedCode!.createdAt.getTime()).toBe(5 * 60 * 1000);
    await connection.db
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(verification.id, storedCode!.id));
    const expired = await exchangeCode({
      clientId: publicClient.client_id,
      code: expiringAuthorization.searchParams.get("code")!,
      redirectUri,
      requestId: "flow-token-expired",
      verifier: expiringVerifier,
    });
    expect(expired.status).toBe(401);
    expect(await expired.text()).toContain("invalid_grant");

    const verifier = "valid-verifier-123456789012345678901234567890123";
    const nonce = `nonce-${runId}`;
    const state = `state-${runId}`;
    const authorization = await authorizePublicClient({
      clientId: publicClient.client_id,
      nonce,
      redirectUri,
      requestId: "flow-authorize-valid",
      state,
      verifier,
    });
    expect(authorization.searchParams.get("state")).toBe(state);
    expect(authorization.searchParams.get("iss")).toBe(baseURL);
    const code = authorization.searchParams.get("code")!;
    const token = await exchangeCode({
      clientId: publicClient.client_id,
      code,
      redirectUri,
      requestId: "flow-token-valid",
      verifier,
    });
    expect(token.status).toBe(200);
    expect(token.headers.get("cache-control")).toBe("no-store");
    const tokenSet = (await token.json()) as {
      access_token: string;
      id_token: string;
      token_type: string;
    };
    expect(tokenSet.access_token).toBeTruthy();
    expect(tokenSet.token_type).toBe("Bearer");
    const idTokenPayload = JSON.parse(
      Buffer.from(tokenSet.id_token.split(".")[1]!, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    expect(idTokenPayload.nonce).toBe(nonce);

    const replay = await exchangeCode({
      clientId: publicClient.client_id,
      code,
      redirectUri,
      requestId: "flow-token-replay",
      verifier,
    });
    expect(replay.status).toBe(401);
    expect(await replay.text()).toContain("invalid_grant");

    const protocolAudits = await connection.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.actorUserId, adminId));
    expect(
      protocolAudits.find((event) => event.requestId === `${runId}-flow-authorize-wrong-redirect`),
    ).toMatchObject({ action: "oauth.authorize", outcome: "denied" });
    expect(
      protocolAudits.find((event) => event.requestId === `${runId}-flow-authorize-valid`),
    ).toMatchObject({ action: "oauth.authorize", outcome: "success" });
    expect(
      protocolAudits.find(
        (event) => event.requestId === `${runId}-flow-authorize-disallowed-scope`,
      ),
    ).toMatchObject({ action: "oauth.authorize", outcome: "denied" });

    const deleted = await privilegedRequest(
      "/oauth2/delete-client",
      {
        body: JSON.stringify({ client_id: publicClient.client_id }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
      "flow-client-delete",
    );
    expect(deleted.status).toBe(200);
  });

  test("interoperates end to end with the seeded NTScout public client", async () => {
    const redirectUri = "https://ntscout.example/auth/callback";
    await provisionNtscoutClient(connection, {
      NTSCOUT_ENVIRONMENT: "production",
      NTSCOUT_REDIRECT_URIS: [redirectUri],
      requestId: `${runId}-ntscout-seed`,
    });
    await connection.db.insert(oauthConsents).values({
      clientId: NTSCOUT_CLIENT_ID,
      id: crypto.randomUUID(),
      referenceId: organizationId,
      scopes: ["openid", "profile", "email", "offline_access", "ntscout:access"],
      userId: adminId,
    });

    const verifier = "ntscout-verifier-1234567890123456789012345678901234";
    const authorization = await authorizePublicClient({
      clientId: NTSCOUT_CLIENT_ID,
      nonce: `ntscout-nonce-${runId}`,
      redirectUri,
      requestId: "ntscout-authorize",
      scope: "openid profile email offline_access ntscout:access",
      state: `ntscout-state-${runId}`,
      verifier,
    });
    const token = await exchangeCode({
      clientId: NTSCOUT_CLIENT_ID,
      code: authorization.searchParams.get("code")!,
      redirectUri,
      requestId: "ntscout-token",
      verifier,
    });
    expect(token.status).toBe(200);
    const tokenSet = (await token.json()) as {
      access_token: string;
      id_token: string;
      refresh_token: string;
    };
    expect(tokenSet.access_token).toBeTruthy();
    expect(tokenSet.id_token).toBeTruthy();
    expect(tokenSet.refresh_token).toStartWith("ntauth_refresh_");
    const ntscoutIdToken = JSON.parse(
      Buffer.from(tokenSet.id_token.split(".")[1]!, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    expect(ntscoutIdToken).toMatchObject({
      email: `oauth-registry-admin-${runId}@example.test`,
      email_verified: true,
      name: "OAuth registry administrator",
    });
    expect(ntscoutIdToken).not.toHaveProperty("environment");
    expect(ntscoutIdToken).not.toHaveProperty("managedBy");
    expect(ntscoutIdToken).not.toHaveProperty("metadata");
    expect(ntscoutIdToken).not.toHaveProperty("role");
    const [storedRefresh] = await connection.db
      .select({ organizationId: oauthRefreshTokens.referenceId })
      .from(oauthRefreshTokens)
      .where(eq(oauthRefreshTokens.clientId, NTSCOUT_CLIENT_ID))
      .limit(1);
    expect(storedRefresh?.organizationId).toBe(organizationId);

    await connection.db
      .update(organizations)
      .set({ status: "suspended" })
      .where(eq(organizations.id, organizationId));
    const suspendedRefresh = await handler()(
      new Request(`${baseURL}/oauth2/token`, {
        body: new URLSearchParams({
          client_id: NTSCOUT_CLIENT_ID,
          grant_type: "refresh_token",
          refresh_token: tokenSet.refresh_token,
        }),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-request-id": `${runId}-ntscout-refresh-suspended`,
        },
        method: "POST",
      }),
    );
    expect(suspendedRefresh.status).toBe(400);
    expect(await suspendedRefresh.json()).toEqual({
      error: "invalid_grant",
      error_description: "organization context is invalid",
    });
    await connection.db
      .update(organizations)
      .set({ status: "active" })
      .where(eq(organizations.id, organizationId));
    await connection.db
      .update(organizationMembers)
      .set({ status: "suspended" })
      .where(eq(organizationMembers.organizationId, organizationId));
    const suspendedMembershipRefresh = await handler()(
      new Request(`${baseURL}/oauth2/token`, {
        body: new URLSearchParams({
          client_id: NTSCOUT_CLIENT_ID,
          grant_type: "refresh_token",
          refresh_token: tokenSet.refresh_token,
        }),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-request-id": `${runId}-ntscout-refresh-suspended-membership`,
        },
        method: "POST",
      }),
    );
    expect(suspendedMembershipRefresh.status).toBe(400);
    expect(await suspendedMembershipRefresh.json()).toEqual({
      error: "invalid_grant",
      error_description: "organization context is invalid",
    });
    await connection.db
      .update(organizationMembers)
      .set({ status: "active" })
      .where(eq(organizationMembers.organizationId, organizationId));

    const [seedAudit] = await connection.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.requestId, `${runId}-ntscout-seed`));
    expect(seedAudit).toMatchObject({
      action: "oauth.client.seed",
      outcome: "success",
      resourceId: NTSCOUT_CLIENT_ID,
    });
    const [refreshAudit] = await connection.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.requestId, `${runId}-ntscout-refresh-suspended-membership`));
    expect(refreshAudit).toMatchObject({
      action: "oauth.token",
      organizationId,
      outcome: "denied",
    });
    await connection.db.delete(oauthClients).where(eq(oauthClients.clientId, NTSCOUT_CLIENT_ID));
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
