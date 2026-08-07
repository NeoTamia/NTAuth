import { auditEvents, type DatabaseConnection } from "@neotamia/db";

import type { createAuth } from "./auth";

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
    if (!pathname.includes("/oauth2/") || !sensitiveEndpoints.has(endpoint))
      return auth.handler(request);

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
