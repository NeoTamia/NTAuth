import { Elysia } from "elysia";

import {
  AuditEventAuthorizationError,
  AuditEventInputError,
  listIamAuditEvents,
  type AuditOutcome,
  type DatabaseConnection,
} from "@neotamia/db";

import type { createAuth } from "./auth/auth";
import { enforceRequestMfa, mfaProblem } from "./mfa";

type Auth = ReturnType<typeof createAuth>;

function problem(status: number, code: string, title: string) {
  return new Response(JSON.stringify({ code, status, title, type: `urn:ntauth:error:${code}` }), {
    headers: { "content-type": "application/problem+json" },
    status,
  });
}

function parseLimit(value: string | undefined) {
  if (value === undefined) return undefined;
  if (!/^\d{1,3}$/.test(value)) throw new AuditEventInputError();
  return Number(value);
}

export function createAuditEventRoutes(options: {
  applicationSecret: string;
  auth: Auth;
  database: DatabaseConnection;
}) {
  return new Elysia().get("/api/v1/audit-events", async ({ query, request }) => {
    const current = await options.auth.api.getSession({ headers: request.headers });
    if (!current) return problem(401, "authentication_required", "Authentication required");
    const organizationId = query.organization_id;
    if (
      organizationId !== undefined &&
      (typeof organizationId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          organizationId,
        ))
    ) {
      return problem(400, "invalid_request", "Invalid audit event query");
    }
    const actor = {
      requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
      userId: current.user.id,
    };
    try {
      await enforceRequestMfa(options.database, options.applicationSecret, request, actor);
      return await listIamAuditEvents(
        options.database,
        {
          action: query.action,
          cursor: query.cursor,
          limit: parseLimit(query.limit),
          organizationId,
          outcome: query.outcome as AuditOutcome | undefined,
          service: query.service,
        },
        actor,
      );
    } catch (error) {
      const challenge = mfaProblem(error);
      if (challenge) return challenge;
      if (error instanceof AuditEventAuthorizationError)
        return problem(403, "forbidden", "Audit event access not permitted");
      if (error instanceof AuditEventInputError)
        return problem(400, "invalid_request", "Invalid audit event query");
      return problem(500, "internal_error", "Audit event query failed");
    }
  });
}
