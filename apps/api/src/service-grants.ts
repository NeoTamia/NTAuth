import { Elysia } from "elysia";

import {
  createServiceGrant,
  listServiceGrants,
  revokeServiceGrant,
  ServiceGrantAuthorizationError,
  ServiceGrantConflictError,
  ServiceGrantNotFoundError,
  setServiceGrantActive,
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

function objectBody(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validService(value: string) {
  return /^[a-z][a-z0-9-]{0,62}$/.test(value);
}

function grantProblem(error: unknown) {
  if (error instanceof ServiceGrantAuthorizationError)
    return problem(403, "forbidden", "Service grant operation not permitted");
  if (error instanceof ServiceGrantNotFoundError)
    return problem(404, "service_grant_not_found", "Service grant not found");
  if (error instanceof ServiceGrantConflictError)
    return problem(409, "service_grant_conflict", "Service grant conflicts with current state");
  return problem(500, "internal_error", "Service grant operation failed");
}

export function createServiceGrantRoutes(options: {
  applicationSecret: string;
  auth: Auth;
  database: DatabaseConnection;
}) {
  const actorFrom = async (request: Request) => {
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
    const current = await options.auth.api.getSession({ headers: request.headers });
    return current ? { requestId, userId: current.user.id } : undefined;
  };
  const privilegedActor = async (request: Request) => {
    const actor = await actorFrom(request);
    if (!actor)
      return { response: problem(401, "authentication_required", "Authentication required") };
    try {
      await enforceRequestMfa(options.database, options.applicationSecret, request, actor);
      return { actor };
    } catch (error) {
      return { response: mfaProblem(error) ?? problem(403, "forbidden", "MFA challenge failed") };
    }
  };

  return new Elysia({ prefix: "/api/v1/service-grants" })
    .post("/", async ({ body, request }) => {
      const access = await privilegedActor(request);
      if (access.response) return access.response;
      const input = objectBody(body);
      if (
        typeof input?.organizationId !== "string" ||
        !validUuid(input.organizationId) ||
        typeof input.service !== "string" ||
        !validService(input.service) ||
        typeof input.userId !== "string" ||
        (input.active !== undefined && typeof input.active !== "boolean")
      ) {
        return problem(400, "invalid_request", "Invalid service grant request");
      }
      try {
        const grant = await createServiceGrant(
          options.database,
          {
            active: input.active as boolean | undefined,
            organizationId: input.organizationId,
            service: input.service,
            userId: input.userId,
          },
          access.actor!,
        );
        return Response.json(grant, { status: 201 });
      } catch (error) {
        return grantProblem(error);
      }
    })
    .get("/", async ({ query, request }) => {
      const access = await privilegedActor(request);
      if (access.response) return access.response;
      if (
        typeof query.organizationId !== "string" ||
        !validUuid(query.organizationId) ||
        (query.service !== undefined && !validService(query.service)) ||
        (query.userId !== undefined && typeof query.userId !== "string")
      ) {
        return problem(400, "invalid_request", "Invalid service grant query");
      }
      try {
        return await listServiceGrants(
          options.database,
          {
            organizationId: query.organizationId,
            service: query.service,
            userId: query.userId,
          },
          access.actor!,
        );
      } catch (error) {
        return grantProblem(error);
      }
    })
    .patch("/:id", async ({ body, params, request }) => {
      const access = await privilegedActor(request);
      if (access.response) return access.response;
      const input = objectBody(body);
      if (!validUuid(params.id) || typeof input?.active !== "boolean")
        return problem(400, "invalid_request", "Invalid service grant status");
      try {
        return await setServiceGrantActive(
          options.database,
          { active: input.active, grantId: params.id },
          access.actor!,
        );
      } catch (error) {
        return grantProblem(error);
      }
    })
    .delete("/:id", async ({ params, request }) => {
      const access = await privilegedActor(request);
      if (access.response) return access.response;
      if (!validUuid(params.id)) return problem(400, "invalid_request", "Invalid service grant");
      try {
        await revokeServiceGrant(options.database, params.id, access.actor!);
        return new Response(null, { status: 204 });
      } catch (error) {
        return grantProblem(error);
      }
    });
}
