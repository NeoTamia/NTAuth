import { auditEvents, type DatabaseConnection } from "@neotamia/db";

import type { createAuth } from "./auth";
import {
  enforceIntrospectionState,
  handleOidcLogout,
  inspectRevocation,
  persistAccessTokenRevocation,
  validateUserInfoToken,
} from "./oauth-lifecycle";
import {
  hasActiveOrganizationMembership,
  organizationFromOAuthRequest,
  resolveStoredGrantContext,
  withOAuthOrganization,
} from "./oauth-organization";
import { withPublicMetadataCache } from "./public-cache";

type Auth = ReturnType<typeof createAuth>;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const sensitiveEndpoints = new Set([
  "authorize",
  "client",
  "consent",
  "continue",
  "create-client",
  "delete-client",
  "end-session",
  "get-client",
  "get-clients",
  "introspect",
  "revoke",
  "rotate-secret",
  "token",
  "update-client",
  "userinfo",
]);

async function oauthOutcome(response: Response): Promise<"denied" | "success"> {
  const location = response.headers.get("location");
  if (location) {
    try {
      if (new URL(location).searchParams.has("error")) return "denied";
      if (response.status >= 300 && response.status < 400) return "success";
    } catch {
      return "denied";
    }
  }
  if (!response.ok) return "denied";
  if (response.headers.get("content-type")?.includes("application/json")) {
    try {
      const body = (await response.clone().json()) as { url?: unknown };
      if (typeof body.url === "string" && new URL(body.url).searchParams.has("error")) {
        return "denied";
      }
    } catch {
      // A successful non-redirect JSON response has no protocol error to classify.
    }
  }
  return "success";
}

export function createAuditedAuthHandler(auth: Auth, database: DatabaseConnection) {
  return async (request: Request) => {
    const pathname = new URL(request.url).pathname;
    const endpoint = pathname.split("/").at(-1) ?? "unknown";
    const sensitive = pathname.includes("/oauth2/") && sensitiveEndpoints.has(endpoint);
    if (!sensitive) {
      const response = await auth.handler(request);
      return pathname.endsWith("/jwks") || pathname.includes("/.well-known/")
        ? withPublicMetadataCache(request, response)
        : response;
    }

    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
    const current = await auth.api.getSession({ headers: request.headers });
    let tokenBody: URLSearchParams | undefined;
    let storedGrant: Awaited<ReturnType<typeof resolveStoredGrantContext>> | undefined;
    if (endpoint === "token" && request.method === "POST") {
      tokenBody = new URLSearchParams(await request.clone().text());
      storedGrant = await resolveStoredGrantContext(database, tokenBody);
    }
    const logout =
      endpoint === "end-session" ? await handleOidcLogout(auth, database, request) : undefined;
    const revocation =
      endpoint === "revoke" ? await inspectRevocation(auth, database, request) : undefined;
    const requestedOrganizationId = await organizationFromOAuthRequest(request);
    let organizationId =
      requestedOrganizationId && uuidPattern.test(requestedOrganizationId)
        ? requestedOrganizationId
        : undefined;
    let organizationDenied = false;
    if (endpoint === "authorize" || endpoint === "consent" || endpoint === "continue") {
      organizationDenied =
        !organizationId ||
        Boolean(
          current &&
          !(await hasActiveOrganizationMembership(database, current.user.id, organizationId)),
        );
    } else if (storedGrant) {
      if (storedGrant.status === "valid") {
        organizationId = storedGrant.organizationId;
        organizationDenied =
          (storedGrant.grant === "refresh_token" && !storedGrant.sessionActive) ||
          !(await hasActiveOrganizationMembership(
            database,
            storedGrant.userId,
            storedGrant.organizationId,
          ));
      } else if (storedGrant.status === "invalid") {
        organizationDenied = true;
      }
    }
    const invalidUserInfoToken =
      endpoint === "userinfo" ? await validateUserInfoToken(auth, database, request) : undefined;
    let response = logout
      ? logout.response
      : revocation?.response
        ? revocation.response
        : invalidUserInfoToken
          ? invalidUserInfoToken
          : organizationDenied
            ? Response.json(
                {
                  error: endpoint === "token" ? "invalid_grant" : "invalid_request",
                  error_description: "organization context is invalid",
                },
                { status: 400 },
              )
            : organizationId
              ? await withOAuthOrganization(organizationId, () => auth.handler(request))
              : await auth.handler(request);
    if (revocation?.idempotent && !response.ok) {
      response = new Response(null, { status: 200 });
    }
    if (revocation?.payload && response.ok) {
      await persistAccessTokenRevocation(database, revocation);
    }
    if (endpoint === "introspect") {
      response = await enforceIntrospectionState(database, response);
    }
    if (
      tokenBody?.get("grant_type") === "refresh_token" &&
      !response.ok &&
      response.headers.get("content-type")?.includes("application/json")
    ) {
      const error = (await response
        .clone()
        .json()
        .catch(() => undefined)) as { error?: unknown } | undefined;
      if (error?.error === "invalid_grant" || error?.error === "invalid_token") {
        response = Response.json(
          { error: "invalid_grant", error_description: "refresh token is invalid" },
          { status: 400 },
        );
      }
    }
    if (
      endpoint === "token" ||
      endpoint === "revoke" ||
      endpoint === "introspect" ||
      (response.ok && (endpoint === "create-client" || endpoint === "rotate-secret"))
    ) {
      response.headers.set("cache-control", "no-store");
      response.headers.set("pragma", "no-cache");
    }
    await database.db.insert(auditEvents).values({
      action: `oauth.${endpoint}`,
      actorUserId:
        current?.user.id ??
        logout?.userId ??
        (storedGrant?.status === "valid" ? storedGrant.userId : undefined),
      metadata: {
        method: request.method,
        organizationId: organizationId ?? null,
        status: response.status,
      },
      organizationId,
      outcome: await oauthOutcome(response),
      requestId,
      resourceType: "oauth_protocol",
    });
    if (revocation) {
      await database.db.insert(auditEvents).values({
        action: "oauth.token.revoke",
        actorUserId:
          typeof revocation.payload?.sub === "string" ? revocation.payload.sub : undefined,
        metadata: {
          clientId: revocation.clientId,
          status: response.status,
          tokenType: revocation.tokenType,
        },
        outcome: response.ok ? "success" : "denied",
        requestId,
        resourceId:
          typeof revocation.payload?.jti === "string" ? revocation.payload.jti : undefined,
        resourceType: "oauth_token",
      });
    }
    if (storedGrant?.status === "valid" && storedGrant.grant === "refresh_token") {
      await database.db.insert(auditEvents).values({
        action:
          storedGrant.revoked && storedGrant.sessionActive
            ? "oauth.refresh-token.reuse"
            : response.ok
              ? "oauth.refresh-token.rotate"
              : "oauth.refresh-token.exchange",
        actorUserId: storedGrant.userId,
        metadata: {
          clientId: storedGrant.clientId,
          familyRevoked: storedGrant.revoked && storedGrant.sessionActive,
          status: response.status,
        },
        organizationId: storedGrant.organizationId,
        outcome: response.ok ? "success" : "denied",
        requestId,
        resourceId: storedGrant.refreshTokenId,
        resourceType: "oauth_refresh_family",
      });
    }
    response.headers.set("x-request-id", requestId);
    return response;
  };
}
