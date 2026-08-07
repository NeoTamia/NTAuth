import { auditEvents, type DatabaseConnection } from "@neotamia/db";

import type { createAuth } from "./auth";
import { withPublicMetadataCache } from "./public-cache";

type Auth = ReturnType<typeof createAuth>;

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
    const response = await auth.handler(request);
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
      metadata: { method: request.method, status: response.status },
      outcome: await oauthOutcome(response),
      requestId,
      resourceType: "oauth_protocol",
    });
    response.headers.set("x-request-id", requestId);
    return response;
  };
}
