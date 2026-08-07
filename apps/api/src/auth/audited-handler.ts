import { auditEvents, type DatabaseConnection } from "@neotamia/db";

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
    const response = organizationDenied
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
