import type { JSONWebKeySet } from "better-auth";
import { verifyJwsAccessToken } from "better-auth/oauth2";

import { auditEvents, type DatabaseConnection } from "@neotamia/db";
import { NTSCOUT_AUDIENCE, NTSCOUT_SERVICE } from "@neotamia/permissions";

import type { createAuth } from "./auth";
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
  if (!response.ok) return "denied";
  const location = response.headers.get("location");
  if (location) {
    try {
      if (new URL(location).searchParams.has("error")) return "denied";
    } catch {
      return "denied";
    }
  }
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

async function validateUserInfoToken(auth: Auth, request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return;
  const token = authorization.slice("Bearer ".length);
  const url = new URL(request.url);
  const issuer = `${url.origin}${url.pathname.slice(0, -"/oauth2/userinfo".length)}`;
  try {
    const payload = await verifyJwsAccessToken(token, {
      jwksFetch: async () => {
        const response = await auth.handler(new Request(`${issuer}/jwks`));
        if (!response.ok) throw new Error("JWKS unavailable");
        return (await response.json()) as JSONWebKeySet;
      },
      verifyOptions: {
        algorithms: ["ES256"],
        audience: NTSCOUT_AUDIENCE,
        issuer,
      },
    });
    const scopes = typeof payload.scope === "string" ? payload.scope.split(" ") : [];
    if (
      typeof payload.sub !== "string" ||
      payload.azp !== NTSCOUT_SERVICE ||
      typeof payload.sid !== "string" ||
      typeof payload.jti !== "string" ||
      !uuidPattern.test(payload.jti) ||
      typeof payload.organization_id !== "string" ||
      !uuidPattern.test(payload.organization_id) ||
      payload.service !== NTSCOUT_SERVICE ||
      typeof payload.policies_etag !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(payload.policies_etag) ||
      !scopes.includes("openid") ||
      !scopes.includes("ntscout:access")
    ) {
      throw new Error("Invalid NTAuth access-token claims");
    }
  } catch {
    return Response.json(
      { error: "invalid_token", error_description: "access token is invalid" },
      {
        headers: { "www-authenticate": 'Bearer error="invalid_token"' },
        status: 401,
      },
    );
  }
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
    } else if (endpoint === "token" && request.method === "POST") {
      const grant = await resolveStoredGrantContext(
        database,
        new URLSearchParams(await request.clone().text()),
      );
      if (grant.status === "valid") {
        organizationId = grant.organizationId;
        organizationDenied = !(await hasActiveOrganizationMembership(
          database,
          grant.userId,
          grant.organizationId,
        ));
      } else if (grant.status === "invalid") {
        organizationDenied = true;
      }
    }
    const invalidUserInfoToken =
      endpoint === "userinfo" ? await validateUserInfoToken(auth, request) : undefined;
    const response = invalidUserInfoToken
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
    if (
      response.ok &&
      (endpoint === "create-client" || endpoint === "rotate-secret" || endpoint === "token")
    ) {
      response.headers.set("cache-control", "no-store");
      response.headers.set("pragma", "no-cache");
    }
    await database.db.insert(auditEvents).values({
      action: `oauth.${endpoint}`,
      actorUserId: current?.user.id,
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
    response.headers.set("x-request-id", requestId);
    return response;
  };
}
