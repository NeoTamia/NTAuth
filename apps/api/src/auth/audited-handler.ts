import { auditEvents, type DatabaseConnection } from "@neotamia/db";

import type { createAuth } from "./auth";
import { withPublicMetadataCache } from "./public-cache";

type Auth = ReturnType<typeof createAuth>;

const sensitiveEndpoints = new Set([
  "authorize",
  "consent",
  "continue",
  "end-session",
  "introspect",
  "revoke",
  "token",
]);

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
    await database.db.insert(auditEvents).values({
      action: `oauth.${endpoint}`,
      actorUserId: current?.user.id,
      metadata: { method: request.method, status: response.status },
      outcome: response.status < 400 ? "success" : "denied",
      requestId,
      resourceType: "oauth_protocol",
    });
    response.headers.set("x-request-id", requestId);
    return response;
  };
}
