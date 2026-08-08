import { Elysia } from "elysia";

import {
  AuditEventAuthorizationError,
  AuditEventInputError,
  exportIamAuditEvents,
  listAvailableServices,
  listIamAuditEvents,
  listManagedOrganizations,
  OrganizationAuthorizationError,
  type AuditOutcome,
  type DatabaseConnection,
  type IamAuditQuery,
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

function parseDate(value: string | undefined) {
  if (value === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    throw new AuditEventInputError();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AuditEventInputError();
  return date;
}

function parseAuditQuery(query: Record<string, string | undefined>): IamAuditQuery {
  const organizationId = query.organization_id;
  if (
    organizationId !== undefined &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      organizationId,
    )
  )
    throw new AuditEventInputError();
  return {
    action: query.action,
    actorUserId: query.actor_user_id,
    cursor: query.cursor,
    from: parseDate(query.from),
    limit: parseLimit(query.limit),
    organizationId,
    outcome: query.outcome as AuditOutcome | undefined,
    service: query.service,
    to: parseDate(query.to),
  };
}

function auditProblem(error: unknown) {
  const challenge = mfaProblem(error);
  if (challenge) return challenge;
  if (error instanceof AuditEventAuthorizationError)
    return problem(403, "forbidden", "Audit event access not permitted");
  if (error instanceof OrganizationAuthorizationError)
    return problem(403, "forbidden", "Audit scopes not permitted");
  if (error instanceof AuditEventInputError)
    return problem(400, "invalid_request", "Invalid audit event query");
  return problem(500, "internal_error", "Audit event query failed");
}

function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function auditCsv(events: Awaited<ReturnType<typeof exportIamAuditEvents>>["events"]) {
  const rows = events.map((event) =>
    [
      event.createdAt.toISOString(),
      event.outcome,
      event.action,
      event.actor.id,
      event.scope.organizationId,
      event.scope.service,
      event.target.type,
      event.target.id,
      event.correlationId,
      JSON.stringify(event.metadata),
    ]
      .map(csvCell)
      .join(","),
  );
  return [
    "created_at,outcome,action,actor_user_id,organization_id,service,target_type,target_id,correlation_id,metadata",
    ...rows,
  ].join("\n");
}

export function createAuditEventRoutes(options: {
  applicationSecret: string;
  auth: Auth;
  database: DatabaseConnection;
}) {
  const access = async (request: Request) => {
    const current = await options.auth.api.getSession({ headers: request.headers });
    if (!current)
      return { response: problem(401, "authentication_required", "Authentication required") };
    const actor = {
      requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
      userId: current.user.id,
    };
    try {
      await enforceRequestMfa(options.database, options.applicationSecret, request, actor);
      return { actor };
    } catch (error) {
      return { response: auditProblem(error) };
    }
  };

  return new Elysia()
    .get("/api/v1/audit-events/scopes", async ({ request }) => {
      const allowed = await access(request);
      if (allowed.response) return allowed.response;
      try {
        const [organizations, services] = await Promise.all([
          listManagedOrganizations(options.database, allowed.actor!),
          listAvailableServices(options.database),
        ]);
        return { organizations, services };
      } catch (error) {
        return auditProblem(error);
      }
    })
    .get("/api/v1/audit-events/export", async ({ query, request }) => {
      const allowed = await access(request);
      if (allowed.response) return allowed.response;
      try {
        const parsed = parseAuditQuery(query);
        const exported = await exportIamAuditEvents(
          options.database,
          {
            action: parsed.action,
            actorUserId: parsed.actorUserId,
            from: parsed.from,
            organizationId: parsed.organizationId,
            outcome: parsed.outcome,
            service: parsed.service,
            to: parsed.to,
          },
          allowed.actor!,
        );
        return new Response(auditCsv(exported.events), {
          headers: {
            "cache-control": "no-store",
            "content-disposition": `attachment; filename="ntauth-audit-${new Date().toISOString().slice(0, 10)}.csv"`,
            "content-type": "text/csv; charset=utf-8",
            "x-ntauth-export-truncated": String(exported.truncated),
          },
        });
      } catch (error) {
        return auditProblem(error);
      }
    })
    .get("/api/v1/audit-events", async ({ query, request }) => {
      const allowed = await access(request);
      if (allowed.response) return allowed.response;
      try {
        return await listIamAuditEvents(options.database, parseAuditQuery(query), allowed.actor!);
      } catch (error) {
        return auditProblem(error);
      }
    });
}
