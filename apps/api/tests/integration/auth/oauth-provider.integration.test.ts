import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hashPassword } from "better-auth/crypto";
import { and, desc, eq, like } from "drizzle-orm";
import { Elysia } from "elysia";

import { ntauth } from "@neotamia/elysia-auth";
import { NTSCOUT_AUDIENCE, NTSCOUT_SERVICE } from "@neotamia/permissions";

import {
  account,
  applyMigrations,
  attachIamPolicy,
  auditEvents,
  createIamCatalogEntry,
  createIamPolicy,
  createService,
  createServiceGrant,
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
  oauthTokenRevocations,
  organizationMembers,
  organizations,
  platformRoleAssignments,
  provisionNtscoutClient,
  session,
  services,
  serviceGrants,
  setIamPolicyStatus,
  setServiceGrantActive,
  totpCounter,
  user,
  verification,
  type DatabaseConnection,
} from "@neotamia/db";
import { deleteAuditEventsForTest } from "@neotamia/db/test-support";

import { createAuditedAuthHandler } from "@/auth/audited-handler";
import { createAuth } from "@/auth/auth";
import { createDiscoveryRoutes } from "@/auth/discovery";
import { enforceIntrospectionState } from "@/auth/oauth-lifecycle";
import { SIGNING_KEY_GRACE_SECONDS, SIGNING_KEY_ROTATION_SECONDS } from "@/auth/signing-key-policy";
import { createApp } from "@/app";
import { createEffectivePolicyRoutes } from "@/effective-policies";
import { createSigningKeyRoutes } from "@/signing-keys";

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
  let emergencyKeyId: string | undefined;
  let emergencyPreviousExpiration: Date | null | undefined;
  let emergencyPreviousKeyId: string | undefined;
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
    await createService(
      connection,
      { key: NTSCOUT_SERVICE, name: "NTScout", ownerUserId: adminId },
      { requestId: `${runId}-ntscout-service`, userId: adminId },
    );
    await createIamCatalogEntry(
      connection,
      {
        identifier: "ntscout:report:read",
        kind: "action",
        service: NTSCOUT_SERVICE,
      },
      { requestId: `${runId}-ntscout-catalog-action`, userId: adminId },
    );
    await createIamCatalogEntry(
      connection,
      {
        identifier: "ntscout:report:*",
        kind: "resource",
        service: NTSCOUT_SERVICE,
      },
      { requestId: `${runId}-ntscout-catalog-resource`, userId: adminId },
    );
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
    expect(signIn.status, await signIn.clone().text()).toBe(200);
    const cookie = signIn.headers.get("set-cookie");
    expect(cookie).toBeTruthy();
    adminCookie = cookie!.split(";")[0]!;
  });

  afterAll(async () => {
    await deleteAuditEventsForTest(connection, { requestIdPrefixes: [`${runId}-`] });
    if (emergencyKeyId)
      await connection.db.delete(jwksTable).where(eq(jwksTable.id, emergencyKeyId));
    if (emergencyPreviousKeyId) {
      await connection.db
        .update(jwksTable)
        .set({ expiresAt: emergencyPreviousExpiration })
        .where(eq(jwksTable.id, emergencyPreviousKeyId));
    }
    await connection.client`delete from jwks where id = ${`expired-${runId}`}`;
    await connection.db.delete(oauthClients).where(eq(oauthClients.clientId, NTSCOUT_CLIENT_ID));
    await connection.db.delete(organizations).where(eq(organizations.id, organizationId));
    await connection.db.delete(services).where(eq(services.key, NTSCOUT_SERVICE));
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
      effectivePolicyRoutes: createEffectivePolicyRoutes({
        applicationSecret,
        auth: currentAuth,
        database: connection,
      }),
      signingKeyRoutes: createSigningKeyRoutes({
        applicationSecret,
        auth: currentAuth,
        database: connection,
      }),
    });
  };

  async function privilegedHeaders(init: RequestInit, requestId: string) {
    const counter = totpCounter();
    await connection.db
      .update(mfaEnrollments)
      .set({ lastUsedCounter: counter - 1 })
      .where(eq(mfaEnrollments.userId, adminId));
    const headers = new Headers(init.headers);
    headers.set("cookie", adminCookie);
    headers.set("origin", "http://localhost");
    headers.set("x-ntauth-totp", await generateTotpCode(totpSecret, counter));
    headers.set("x-request-id", `${runId}-${requestId}`);
    return headers;
  }

  async function privilegedRequest(path: string, init: RequestInit, requestId: string) {
    const headers = await privilegedHeaders(init, requestId);
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
    resource?: string;
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
          ...(input.resource ? { resource: input.resource } : {}),
        }),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-request-id": `${runId}-${input.requestId}`,
        },
        method: "POST",
      }),
    );

  const exchangeRefreshToken = (input: {
    refreshToken: string;
    requestId: string;
    scope?: string;
  }) =>
    handler()(
      new Request(`${baseURL}/oauth2/token`, {
        body: new URLSearchParams({
          client_id: NTSCOUT_CLIENT_ID,
          grant_type: "refresh_token",
          refresh_token: input.refreshToken,
          resource: NTSCOUT_AUDIENCE,
          ...(input.scope ? { scope: input.scope } : {}),
        }),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-request-id": `${runId}-${input.requestId}`,
        },
        method: "POST",
      }),
    );

  async function verifyEs256Jwt(token: string) {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
    expect(encodedHeader).toBeTruthy();
    expect(encodedPayload).toBeTruthy();
    expect(encodedSignature).toBeTruthy();
    const header = JSON.parse(Buffer.from(encodedHeader!, "base64url").toString("utf8")) as {
      alg: string;
      kid: string;
    };
    expect(header.alg).toBe("ES256");
    const [storedKey] = await connection.db
      .select({ publicKey: jwksTable.publicKey })
      .from(jwksTable)
      .where(eq(jwksTable.id, header.kid))
      .limit(1);
    expect(storedKey).toBeDefined();
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      JSON.parse(storedKey!.publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    expect(
      await crypto.subtle.verify(
        { hash: "SHA-256", name: "ECDSA" },
        publicKey,
        Buffer.from(encodedSignature!, "base64url"),
        new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
      ),
    ).toBe(true);
    return JSON.parse(Buffer.from(encodedPayload!, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
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
        headers: {
          "content-type": "application/json",
          cookie: adminCookie,
          origin: "http://localhost",
        },
        method: "POST",
      }),
    );
    expect(denied.status, await denied.clone().text()).toBe(401);

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
    expect(created.status, await created.clone().text()).toBe(200);
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
      .where(like(auditEvents.requestId, `${runId}-flow-%`));
    const expectedProtocolOutcomes = new Map<string, [string, "denied" | "success"]>([
      ["authorize-altered-organization", ["oauth.authorize", "denied"]],
      ["authorize-disallowed-scope", ["oauth.authorize", "denied"]],
      ["authorize-missing-pkce", ["oauth.authorize", "denied"]],
      ["authorize-plain-pkce", ["oauth.authorize", "denied"]],
      ["authorize-valid", ["oauth.authorize", "success"]],
      ["authorize-wrong-redirect", ["oauth.authorize", "denied"]],
      ["token-consumed-after-mismatch", ["oauth.token", "denied"]],
      ["token-expired", ["oauth.token", "denied"]],
      ["token-replay", ["oauth.token", "denied"]],
      ["token-valid", ["oauth.token", "success"]],
      ["token-wrong-redirect", ["oauth.token", "denied"]],
      ["token-wrong-verifier", ["oauth.token", "denied"]],
    ]);
    for (const [suffix, [action, outcome]] of expectedProtocolOutcomes) {
      const event = protocolAudits.find(
        (candidate) => candidate.requestId === `${runId}-flow-${suffix}`,
      );
      expect(event).toMatchObject({
        action,
        outcome,
        requestId: `${runId}-flow-${suffix}`,
        resourceType: "oauth_protocol",
      });
      expect(JSON.stringify(event?.metadata)).not.toMatch(
        /authorization|code_verifier|refresh_token|client_secret/i,
      );
    }

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

    const invalidResourceVerifier = "ntscout-invalid-resource-verifier-123456789012345678901234";
    const invalidResourceAuthorization = await authorizePublicClient({
      clientId: NTSCOUT_CLIENT_ID,
      nonce: `ntscout-invalid-resource-nonce-${runId}`,
      redirectUri,
      requestId: "ntscout-authorize-invalid-resource",
      scope: "openid ntscout:access",
      state: `ntscout-invalid-resource-state-${runId}`,
      verifier: invalidResourceVerifier,
    });
    const invalidResource = await exchangeCode({
      clientId: NTSCOUT_CLIENT_ID,
      code: invalidResourceAuthorization.searchParams.get("code")!,
      redirectUri,
      requestId: "ntscout-token-invalid-resource",
      resource: "urn:neotamia:service:unregistered",
      verifier: invalidResourceVerifier,
    });
    expect(invalidResource.status).toBe(400);
    expect(await invalidResource.json()).toEqual({
      error: "invalid_request",
      error_description: "requested resource invalid",
    });

    const missingGrantVerifier = "ntscout-missing-grant-verifier-123456789012345678901234";
    const missingGrantAuthorization = await authorizePublicClient({
      clientId: NTSCOUT_CLIENT_ID,
      nonce: `ntscout-missing-grant-nonce-${runId}`,
      redirectUri,
      requestId: "ntscout-authorize-missing-grant",
      scope: "openid ntscout:access",
      state: `ntscout-missing-grant-state-${runId}`,
      verifier: missingGrantVerifier,
    });
    const missingGrant = await exchangeCode({
      clientId: NTSCOUT_CLIENT_ID,
      code: missingGrantAuthorization.searchParams.get("code")!,
      redirectUri,
      requestId: "ntscout-token-missing-grant",
      resource: NTSCOUT_AUDIENCE,
      verifier: missingGrantVerifier,
    });
    expect(missingGrant.status).toBe(400);
    expect(await missingGrant.json()).toEqual({
      error: "invalid_request",
      error_description: "access token context is invalid",
    });
    const grant = await createServiceGrant(
      connection,
      { organizationId, service: NTSCOUT_SERVICE, userId: adminId },
      { requestId: `${runId}-ntscout-grant`, userId: adminId },
    );
    const policy = await createIamPolicy(
      connection,
      {
        document: {
          statements: [
            {
              actions: ["ntscout:report:read"],
              effect: "Allow",
              resources: ["ntscout:report:*"],
            },
          ],
          version: "2026-01-01",
        },
        name: `NTScout pilot ${runId}`,
        organizationId,
        service: NTSCOUT_SERVICE,
      },
      { requestId: `${runId}-ntscout-policy`, userId: adminId },
    );
    await attachIamPolicy(
      connection,
      { policyId: policy.policy.id, principalId: adminId, principalType: "user" },
      { requestId: `${runId}-ntscout-policy-attachment`, userId: adminId },
    );

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
      resource: NTSCOUT_AUDIENCE,
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
    const accessToken = await verifyEs256Jwt(tokenSet.access_token);
    const now = Math.floor(Date.now() / 1000);
    expect(accessToken).toMatchObject({
      azp: NTSCOUT_CLIENT_ID,
      iss: baseURL,
      organization_id: organizationId,
      service: NTSCOUT_SERVICE,
      sub: adminId,
    });
    expect(accessToken.aud).toEqual([NTSCOUT_AUDIENCE, `${baseURL}/oauth2/userinfo`]);
    expect(accessToken.scope).toBe("openid profile email offline_access ntscout:access");
    expect(accessToken.policies_etag).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(typeof accessToken.jti).toBe("string");
    expect(String(accessToken.jti)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect((accessToken.exp as number) - (accessToken.iat as number)).toBe(15 * 60);
    expect(accessToken.iat as number).toBeLessThanOrEqual(now);
    expect(accessToken.exp as number).toBeGreaterThan(now);
    expect(accessToken).not.toHaveProperty("environment");
    expect(accessToken).not.toHaveProperty("managedBy");
    expect(accessToken).not.toHaveProperty("metadata");
    expect(accessToken).not.toHaveProperty("role");
    expect(typeof accessToken.sid).toBe("string");
    expect(Object.keys(accessToken).toSorted()).toEqual(
      [
        "aud",
        "azp",
        "exp",
        "iat",
        "iss",
        "jti",
        "organization_id",
        "policies_etag",
        "scope",
        "service",
        "sid",
        "sub",
      ].toSorted(),
    );

    const oauthApplication = application();
    const jwksResponse = await oauthApplication.handle(new Request(`${baseURL}/jwks`));
    expect(jwksResponse.status).toBe(200);
    const jwks = (await jwksResponse.json()) as NonNullable<Parameters<typeof ntauth>[0]["jwks"]>;
    const resourceServer = new Elysia()
      .use(
        ntauth({
          audience: NTSCOUT_AUDIENCE,
          fetch: (input, init) => oauthApplication.handle(new Request(input, init)),
          issuer: baseURL,
          jwks,
          requiredScopes: ["openid", "ntscout:access"],
          service: NTSCOUT_SERVICE,
        }),
      )
      .get("/reports/:id", ({ auth: context, params, set }) => {
        const decision = context.authorize({
          action: "ntscout:report:read",
          resource: `ntscout:report:${params.id}`,
        });
        if (!decision.allowed) set.status = 403;
        return { allowed: decision.allowed, etag: context.policies.etag };
      });
    const authorizedReport = await resourceServer.handle(
      new Request("http://ntscout.local/reports/monthly", {
        headers: { authorization: `Bearer ${tokenSet.access_token}` },
      }),
    );
    expect(authorizedReport.status).toBe(200);
    const authorizedReportBody = (await authorizedReport.json()) as {
      allowed: boolean;
      etag: string;
    };
    expect(authorizedReportBody.allowed).toBe(true);
    expect(authorizedReportBody.etag).toMatch(/^"[0-9a-f]{64}"$/);

    const ntscoutIdToken = await verifyEs256Jwt(tokenSet.id_token);
    expect(ntscoutIdToken).toMatchObject({
      aud: NTSCOUT_CLIENT_ID,
      iss: baseURL,
      nonce: `ntscout-nonce-${runId}`,
      sub: adminId,
    });
    expect((ntscoutIdToken.exp as number) - (ntscoutIdToken.iat as number)).toBe(15 * 60);
    expect(ntscoutIdToken).toMatchObject({
      email: `oauth-registry-admin-${runId}@example.test`,
      email_verified: true,
      name: "OAuth registry administrator",
    });
    expect(ntscoutIdToken).not.toHaveProperty("environment");
    expect(ntscoutIdToken).not.toHaveProperty("managedBy");
    expect(ntscoutIdToken).not.toHaveProperty("metadata");
    expect(ntscoutIdToken).not.toHaveProperty("role");

    const userInfo = await handler()(
      new Request(`${baseURL}/oauth2/userinfo`, {
        headers: {
          authorization: `Bearer ${tokenSet.access_token}`,
          "x-request-id": `${runId}-ntscout-userinfo-valid`,
        },
      }),
    );
    expect(userInfo.status).toBe(200);
    expect(await userInfo.json()).toMatchObject({
      email: `oauth-registry-admin-${runId}@example.test`,
      email_verified: true,
      sub: adminId,
    });

    const tokenParts = tokenSet.access_token.split(".");
    const signatureStart = tokenParts[2]![0]!;
    tokenParts[2] = `${signatureStart === "A" ? "B" : "A"}${tokenParts[2]!.slice(1)}`;
    const tamperedToken = tokenParts.join(".");
    const tampered = await handler()(
      new Request(`${baseURL}/oauth2/userinfo`, {
        headers: {
          authorization: `Bearer ${tamperedToken}`,
          "x-request-id": `${runId}-ntscout-userinfo-tampered`,
        },
      }),
    );
    expect(tampered.status).toBe(401);
    expect(tampered.headers.get("www-authenticate")).toBe('Bearer error="invalid_token"');
    expect(await tampered.json()).toEqual({
      error: "invalid_token",
      error_description: "access token is invalid",
    });

    const strictClaims = {
      azp: NTSCOUT_CLIENT_ID,
      iss: baseURL,
      jti: crypto.randomUUID(),
      organization_id: organizationId,
      policies_etag: accessToken.policies_etag,
      scope: "openid ntscout:access",
      service: NTSCOUT_SERVICE,
      sid: accessToken.sid,
      sub: adminId,
    };
    const expiredToken = await auth().api.signJWT({
      body: {
        payload: {
          aud: NTSCOUT_AUDIENCE,
          ...strictClaims,
          exp: now - 1,
          iat: now - 16 * 60,
        },
      },
    });
    const expiredUserInfo = await handler()(
      new Request(`${baseURL}/oauth2/userinfo`, {
        headers: {
          authorization: `Bearer ${expiredToken.token}`,
          "x-request-id": `${runId}-ntscout-userinfo-expired`,
        },
      }),
    );
    expect(expiredUserInfo.status).toBe(401);
    expect(await expiredUserInfo.json()).toEqual({
      error: "invalid_token",
      error_description: "access token is invalid",
    });
    const wrongAudienceToken = await auth().api.signJWT({
      body: {
        payload: {
          aud: "urn:neotamia:service:unregistered",
          ...strictClaims,
          exp: now + 15 * 60,
          iat: now,
          jti: crypto.randomUUID(),
        },
      },
    });
    const wrongAudienceUserInfo = await handler()(
      new Request(`${baseURL}/oauth2/userinfo`, {
        headers: {
          authorization: `Bearer ${wrongAudienceToken.token}`,
          "x-request-id": `${runId}-ntscout-userinfo-wrong-audience`,
        },
      }),
    );
    expect(wrongAudienceUserInfo.status).toBe(401);
    expect(await wrongAudienceUserInfo.json()).toEqual({
      error: "invalid_token",
      error_description: "access token is invalid",
    });
    const [storedRefresh] = await connection.db
      .select()
      .from(oauthRefreshTokens)
      .where(
        and(
          eq(oauthRefreshTokens.clientId, NTSCOUT_CLIENT_ID),
          eq(oauthRefreshTokens.userId, adminId),
        ),
      )
      .limit(1);
    expect(storedRefresh?.referenceId).toBe(organizationId);
    expect(storedRefresh!.expiresAt.getTime() - storedRefresh!.createdAt.getTime()).toBe(
      30 * 24 * 60 * 60 * 1000,
    );
    expect(storedRefresh!.token).not.toContain(tokenSet.refresh_token);

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
      error_description: "refresh token is invalid",
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
      error_description: "refresh token is invalid",
    });
    await connection.db
      .update(organizationMembers)
      .set({ status: "active" })
      .where(eq(organizationMembers.organizationId, organizationId));

    const rotatedRefresh = await exchangeRefreshToken({
      refreshToken: tokenSet.refresh_token,
      requestId: "ntscout-refresh-rotate",
    });
    expect(rotatedRefresh.status).toBe(200);
    expect(rotatedRefresh.headers.get("cache-control")).toBe("no-store");
    const rotatedTokenSet = (await rotatedRefresh.json()) as {
      access_token: string;
      refresh_token: string;
    };
    expect(rotatedTokenSet.refresh_token).toStartWith("ntauth_refresh_");
    expect(rotatedTokenSet.refresh_token).not.toBe(tokenSet.refresh_token);
    const rotatedAccessToken = await verifyEs256Jwt(rotatedTokenSet.access_token);
    expect(rotatedAccessToken).toMatchObject({
      organization_id: organizationId,
      service: NTSCOUT_SERVICE,
      sub: adminId,
    });
    const refreshRowsAfterRotation = await connection.db
      .select()
      .from(oauthRefreshTokens)
      .where(
        and(
          eq(oauthRefreshTokens.clientId, NTSCOUT_CLIENT_ID),
          eq(oauthRefreshTokens.userId, adminId),
        ),
      );
    expect(refreshRowsAfterRotation).toHaveLength(2);
    const previousRefresh = refreshRowsAfterRotation.find((row) => row.id === storedRefresh!.id);
    const currentRefresh = refreshRowsAfterRotation.find((row) => row.id !== storedRefresh!.id);
    expect(previousRefresh?.revoked).toBeInstanceOf(Date);
    expect(currentRefresh?.revoked).toBeNull();
    expect(currentRefresh!.expiresAt.getTime() - currentRefresh!.createdAt.getTime()).toBe(
      30 * 24 * 60 * 60 * 1000,
    );

    const replay = await exchangeRefreshToken({
      refreshToken: tokenSet.refresh_token,
      requestId: "ntscout-refresh-reuse",
    });
    expect(replay.status).toBe(400);
    expect(replay.headers.get("cache-control")).toBe("no-store");
    expect(await replay.json()).toEqual({
      error: "invalid_grant",
      error_description: "refresh token is invalid",
    });
    const familyAfterReplay = await connection.db
      .select({ id: oauthRefreshTokens.id })
      .from(oauthRefreshTokens)
      .where(
        and(
          eq(oauthRefreshTokens.clientId, NTSCOUT_CLIENT_ID),
          eq(oauthRefreshTokens.userId, adminId),
        ),
      );
    expect(familyAfterReplay).toEqual([]);
    const revokedFamilyToken = await exchangeRefreshToken({
      refreshToken: rotatedTokenSet.refresh_token,
      requestId: "ntscout-refresh-family-revoked",
    });
    expect(revokedFamilyToken.status).toBe(400);
    expect(await revokedFamilyToken.json()).toEqual({
      error: "invalid_grant",
      error_description: "refresh token is invalid",
    });

    const [rotationAudit] = await connection.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "oauth.refresh-token.rotate"),
          eq(auditEvents.requestId, `${runId}-ntscout-refresh-rotate`),
        ),
      );
    expect(rotationAudit).toMatchObject({
      actorUserId: adminId,
      organizationId,
      outcome: "success",
      requestId: `${runId}-ntscout-refresh-rotate`,
    });
    const [reuseAudit] = await connection.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "oauth.refresh-token.reuse"),
          eq(auditEvents.requestId, `${runId}-ntscout-refresh-reuse`),
        ),
      );
    expect(reuseAudit).toMatchObject({
      actorUserId: adminId,
      organizationId,
      outcome: "denied",
      requestId: `${runId}-ntscout-refresh-reuse`,
    });
    expect(reuseAudit?.metadata).toMatchObject({ familyRevoked: true });

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
      .where(
        and(
          eq(auditEvents.action, "oauth.token"),
          eq(auditEvents.requestId, `${runId}-ntscout-refresh-suspended-membership`),
        ),
      );
    expect(refreshAudit).toMatchObject({
      action: "oauth.token",
      organizationId,
      outcome: "denied",
    });
    await setIamPolicyStatus(
      connection,
      { policyId: policy.policy.id, status: "inactive" },
      { requestId: `${runId}-ntscout-policy-disable`, userId: adminId },
    );
    const etagBlockedReport = await resourceServer.handle(
      new Request("http://ntscout.local/reports/monthly", {
        headers: { authorization: `Bearer ${tokenSet.access_token}` },
      }),
    );
    expect(etagBlockedReport.status).toBe(403);
    const etagBlockedReportBody = (await etagBlockedReport.json()) as {
      allowed: boolean;
      etag: string;
    };
    expect(etagBlockedReportBody.allowed).toBe(false);
    expect(etagBlockedReportBody.etag).not.toBe(authorizedReportBody.etag);

    await setServiceGrantActive(
      connection,
      { active: false, grantId: grant.id },
      { requestId: `${runId}-ntscout-grant-disable`, userId: adminId },
    );
    const blockedReport = await resourceServer.handle(
      new Request("http://ntscout.local/reports/monthly", {
        headers: { authorization: `Bearer ${tokenSet.access_token}` },
      }),
    );
    const blockedReportBody = (await blockedReport.json()) as {
      allowed: boolean;
      etag: string;
    };
    await setServiceGrantActive(
      connection,
      { active: true, grantId: grant.id },
      { requestId: `${runId}-ntscout-grant-restore`, userId: adminId },
    );
    expect(blockedReport.status).toBe(403);
    expect(blockedReportBody.allowed).toBe(false);
    expect(blockedReportBody.etag).not.toBe(etagBlockedReportBody.etag);

    const pilotAudits = await connection.db
      .select()
      .from(auditEvents)
      .where(like(auditEvents.requestId, `${runId}-ntscout-%`));
    for (const [requestId, action] of [
      [`${runId}-ntscout-service`, "iam.service.create"],
      [`${runId}-ntscout-catalog-action`, "iam.catalog.create"],
      [`${runId}-ntscout-catalog-resource`, "iam.catalog.create"],
      [`${runId}-ntscout-grant`, "service-grant.create"],
      [`${runId}-ntscout-policy`, "iam.policy.create"],
      [`${runId}-ntscout-policy-attachment`, "iam.policy.attach"],
      [`${runId}-ntscout-policy-disable`, "iam.policy.status.change"],
      [`${runId}-ntscout-grant-disable`, "service-grant.status.change"],
    ]) {
      expect(pilotAudits.find((event) => event.requestId === requestId)).toMatchObject({
        action,
        outcome: "success",
        requestId,
      });
    }
    const securityRefusals = [
      "ntscout-token-invalid-resource",
      "ntscout-userinfo-expired",
      "ntscout-userinfo-tampered",
      "ntscout-userinfo-wrong-audience",
      "ntscout-refresh-suspended",
      "ntscout-refresh-suspended-membership",
      "ntscout-refresh-reuse",
      "ntscout-refresh-family-revoked",
    ];
    const ntscoutAudits = await connection.db
      .select()
      .from(auditEvents)
      .where(like(auditEvents.requestId, `${runId}-ntscout-%`));
    for (const suffix of securityRefusals) {
      const event = ntscoutAudits.find(
        (candidate) =>
          candidate.requestId === `${runId}-${suffix}` &&
          candidate.resourceType === "oauth_protocol",
      );
      expect(event).toMatchObject({
        outcome: "denied",
        requestId: `${runId}-${suffix}`,
        resourceType: "oauth_protocol",
      });
      expect(JSON.stringify(event?.metadata)).not.toMatch(
        /authorization|code_verifier|refresh_token|client_secret/i,
      );
    }
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

  test("rotates ES256 signing keys immediately while retaining the previous public key", async () => {
    const app = application();
    await app.handle(new Request(`${baseURL}/jwks`));
    const currentAuth = auth();
    const issuedAt = Math.floor(Date.now() / 1000);
    const tokenBeforeRotation = await currentAuth.api.signJWT({
      body: {
        payload: {
          exp: issuedAt + 15 * 60,
          iat: issuedAt,
          sub: adminId,
        },
      },
    });
    const previousHeader = JSON.parse(
      Buffer.from(tokenBeforeRotation.token.split(".")[0]!, "base64url").toString("utf8"),
    ) as { alg: string; kid: string };
    expect(previousHeader.alg).toBe("ES256");
    const [previous] = await connection.db
      .select()
      .from(jwksTable)
      .where(eq(jwksTable.id, previousHeader.kid))
      .limit(1);
    emergencyPreviousKeyId = previous!.id;
    emergencyPreviousExpiration = previous!.expiresAt;

    const unauthorized = await app.handle(
      new Request("http://localhost/api/v1/oauth/signing-keys/rotate", {
        body: JSON.stringify({ reason: "emergency" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    );
    expect(unauthorized.status).toBe(401);

    const rotation = await app.handle(
      new Request("http://localhost/api/v1/oauth/signing-keys/rotate", {
        body: JSON.stringify({ reason: "emergency" }),
        headers: await privilegedHeaders(
          { headers: { "content-type": "application/json" } },
          "signing-key-emergency",
        ),
        method: "POST",
      }),
    );
    expect(rotation.status).toBe(200);
    const rotated = (await rotation.json()) as { currentKid: string; previousKid: string };
    expect(rotated.previousKid).toBe(previous!.id);
    expect(rotated.currentKid).not.toBe(rotated.previousKid);
    emergencyKeyId = rotated.currentKid;

    const [next] = await connection.db
      .select()
      .from(jwksTable)
      .where(eq(jwksTable.id, rotated.currentKid))
      .limit(1);
    expect(next?.expiresAt).toBeInstanceOf(Date);
    expect(
      Math.abs(
        next!.expiresAt!.getTime() -
          next!.createdAt.getTime() -
          SIGNING_KEY_ROTATION_SECONDS * 1000,
      ),
    ).toBeLessThan(100);

    const verifiedPrevious = await currentAuth.api.verifyJWT({
      body: { token: tokenBeforeRotation.token },
    });
    expect(verifiedPrevious.payload?.sub).toBe(adminId);
    const overlap = (await (await app.handle(new Request(`${baseURL}/jwks`))).json()) as {
      keys: Array<{ kid: string }>;
    };
    expect(overlap.keys.map((key) => key.kid)).toContain(previous!.id);
    expect(overlap.keys.map((key) => key.kid)).toContain(next!.id);

    await connection.db
      .update(jwksTable)
      .set({ expiresAt: new Date(Date.now() - SIGNING_KEY_GRACE_SECONDS * 1000 - 1) })
      .where(eq(jwksTable.id, previous!.id));
    const afterGrace = (await (await app.handle(new Request(`${baseURL}/jwks`))).json()) as {
      keys: Array<{ kid: string }>;
    };
    expect(afterGrace.keys.map((key) => key.kid)).not.toContain(previous!.id);
    expect(afterGrace.keys.map((key) => key.kid)).toContain(next!.id);

    const [audit] = await connection.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.requestId, `${runId}-signing-key-emergency`));
    expect(audit).toMatchObject({
      action: "oauth.signing-key.rotate",
      actorUserId: adminId,
      outcome: "success",
      resourceId: next!.id,
    });
  });

  test("revokes tokens idempotently and ends the OIDC session with an exact redirect", async () => {
    const redirectUri = "https://ntscout.example/auth/callback";
    const logoutRedirectUri = "https://ntscout.example/";
    await provisionNtscoutClient(connection, {
      NTSCOUT_ENVIRONMENT: "production",
      NTSCOUT_REDIRECT_URIS: [redirectUri],
      requestId: `${runId}-lifecycle-seed`,
    });
    await connection.db
      .insert(serviceGrants)
      .values({
        createdByUserId: adminId,
        organizationId,
        service: NTSCOUT_SERVICE,
        userId: adminId,
      })
      .onConflictDoNothing();
    await connection.db.insert(oauthConsents).values({
      clientId: NTSCOUT_CLIENT_ID,
      id: crypto.randomUUID(),
      referenceId: organizationId,
      scopes: ["openid", "profile", "email", "offline_access", "ntscout:access"],
      userId: adminId,
    });

    const issueTokenSet = async (label: string) => {
      const verifier = `${label}-verifier-123456789012345678901234567890123456`;
      const authorization = await authorizePublicClient({
        clientId: NTSCOUT_CLIENT_ID,
        nonce: `${label}-nonce-${runId}`,
        redirectUri,
        requestId: `${label}-authorize`,
        scope: "openid profile email offline_access ntscout:access",
        state: `${label}-state-${runId}`,
        verifier,
      });
      const response = await exchangeCode({
        clientId: NTSCOUT_CLIENT_ID,
        code: authorization.searchParams.get("code")!,
        redirectUri,
        requestId: `${label}-token`,
        resource: NTSCOUT_AUDIENCE,
        verifier,
      });
      expect(response.status).toBe(200);
      return (await response.json()) as {
        access_token: string;
        id_token: string;
        refresh_token: string;
      };
    };
    const revoke = (token: string, tokenType: "access_token" | "refresh_token", label: string) =>
      handler()(
        new Request(`${baseURL}/oauth2/revoke`, {
          body: new URLSearchParams({
            client_id: NTSCOUT_CLIENT_ID,
            token,
            token_type_hint: tokenType,
          }),
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "x-request-id": `${runId}-${label}`,
          },
          method: "POST",
        }),
      );
    const revocationTokens = await issueTokenSet("lifecycle-revoke");
    const revokedAccessClaims = await verifyEs256Jwt(revocationTokens.access_token);
    const activeIntrospection = await enforceIntrospectionState(
      connection,
      Response.json({ ...revokedAccessClaims, active: true }),
    );
    expect(await activeIntrospection.json()).toMatchObject({ active: true });
    const accessRevocation = await revoke(
      revocationTokens.access_token,
      "access_token",
      "lifecycle-access-revoke",
    );
    expect(accessRevocation.status).toBe(200);
    expect(accessRevocation.headers.get("cache-control")).toBe("no-store");
    const [storedRevocation] = await connection.db
      .select()
      .from(oauthTokenRevocations)
      .where(eq(oauthTokenRevocations.jti, revokedAccessClaims.jti as string));
    expect(storedRevocation).toMatchObject({
      clientId: NTSCOUT_CLIENT_ID,
      sessionId: revokedAccessClaims.sid,
      userId: adminId,
    });
    const revokedUserInfo = await handler()(
      new Request(`${baseURL}/oauth2/userinfo`, {
        headers: { authorization: `Bearer ${revocationTokens.access_token}` },
      }),
    );
    expect(revokedUserInfo.status).toBe(401);
    const revokedIntrospection = await enforceIntrospectionState(
      connection,
      Response.json({ ...revokedAccessClaims, active: true }),
    );
    expect(await revokedIntrospection.json()).toEqual({ active: false });
    expect(
      (
        await revoke(
          revocationTokens.access_token,
          "access_token",
          "lifecycle-access-revoke-repeat",
        )
      ).status,
    ).toBe(200);

    const refreshRevocation = await revoke(
      revocationTokens.refresh_token,
      "refresh_token",
      "lifecycle-refresh-revoke",
    );
    expect(refreshRevocation.status).toBe(200);
    expect(
      (
        await revoke(
          revocationTokens.refresh_token,
          "refresh_token",
          "lifecycle-refresh-revoke-repeat",
        )
      ).status,
    ).toBe(200);
    const revokedRefresh = await exchangeRefreshToken({
      refreshToken: revocationTokens.refresh_token,
      requestId: "lifecycle-refresh-after-revoke",
    });
    expect(revokedRefresh.status).toBe(400);
    expect(await revokedRefresh.json()).toEqual({
      error: "invalid_grant",
      error_description: "refresh token is invalid",
    });
    expect(
      (await revoke("ntauth_refresh_unknown", "refresh_token", "lifecycle-unknown-revoke")).status,
    ).toBe(200);

    const logoutTokens = await issueTokenSet("lifecycle-logout");
    const logoutAccessClaims = await verifyEs256Jwt(logoutTokens.access_token);
    const invalidLogout = await handler()(
      new Request(
        `${baseURL}/oauth2/end-session?${new URLSearchParams({
          client_id: NTSCOUT_CLIENT_ID,
          id_token_hint: logoutTokens.id_token,
          post_logout_redirect_uri: "https://attacker.example/logout",
          state: "must-not-leak",
        })}`,
        { headers: { "x-request-id": `${runId}-lifecycle-logout-invalid-redirect` } },
      ),
    );
    expect(invalidLogout.status).toBe(400);
    expect(invalidLogout.headers.get("location")).toBeNull();
    expect(
      await connection.db
        .select({ id: session.id })
        .from(session)
        .where(eq(session.id, logoutAccessClaims.sid as string)),
    ).toHaveLength(1);

    const logoutState = `logout-state-${runId}`;
    const logout = await handler()(
      new Request(
        `${baseURL}/oauth2/end-session?${new URLSearchParams({
          client_id: NTSCOUT_CLIENT_ID,
          id_token_hint: logoutTokens.id_token,
          post_logout_redirect_uri: logoutRedirectUri,
          state: logoutState,
        })}`,
        { headers: { "x-request-id": `${runId}-lifecycle-logout-valid` } },
      ),
    );
    expect(logout.status).toBe(302);
    expect(logout.headers.get("location")).toBe(`${logoutRedirectUri}?state=${logoutState}`);
    expect(
      await connection.db
        .select({ id: session.id })
        .from(session)
        .where(eq(session.id, logoutAccessClaims.sid as string)),
    ).toEqual([]);
    const logoutUserInfo = await handler()(
      new Request(`${baseURL}/oauth2/userinfo`, {
        headers: { authorization: `Bearer ${logoutTokens.access_token}` },
      }),
    );
    expect(logoutUserInfo.status).toBe(401);
    const logoutIntrospection = await enforceIntrospectionState(
      connection,
      Response.json({ ...logoutAccessClaims, active: true }),
    );
    expect(await logoutIntrospection.json()).toEqual({ active: false });
    const logoutRefresh = await exchangeRefreshToken({
      refreshToken: logoutTokens.refresh_token,
      requestId: "lifecycle-refresh-after-logout",
    });
    expect(logoutRefresh.status).toBe(400);
    expect(await logoutRefresh.json()).toEqual({
      error: "invalid_grant",
      error_description: "refresh token is invalid",
    });

    const [logoutAudit] = await connection.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.requestId, `${runId}-lifecycle-logout-valid`));
    expect(logoutAudit).toMatchObject({
      action: "oauth.end-session",
      actorUserId: adminId,
      outcome: "success",
    });
    const [revocationAudit] = await connection.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.action, "oauth.token.revoke"),
          eq(auditEvents.requestId, `${runId}-lifecycle-access-revoke`),
        ),
      );
    expect(revocationAudit).toMatchObject({
      actorUserId: adminId,
      outcome: "success",
      resourceId: revokedAccessClaims.jti,
    });
    await connection.db.delete(oauthClients).where(eq(oauthClients.clientId, NTSCOUT_CLIENT_ID));
  });
});
