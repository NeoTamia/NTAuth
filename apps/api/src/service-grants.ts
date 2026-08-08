import { Elysia } from "elysia";

import {
  createServiceGrant,
  getOrganizationAdministration,
  listAvailableServices,
  listManagedOrganizations,
  listServiceGrants,
  OrganizationAuthorizationError,
  OrganizationNotFoundError,
  revokeServiceGrant,
  ServiceGrantAuthorizationError,
  ServiceGrantConflictError,
  ServiceGrantNotFoundError,
  setServiceGrantActive,
  type DatabaseConnection,
} from "@neotamia/db";

import type { createAuth } from "./auth/auth";
import type { IamPermissionCache } from "./iam-cache";
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
  if (error instanceof OrganizationAuthorizationError)
    return problem(403, "forbidden", "Organization operation not permitted");
  if (error instanceof OrganizationNotFoundError)
    return problem(404, "organization_not_found", "Organization not found");
  return problem(500, "internal_error", "Service grant operation failed");
}

export function createServiceGrantRoutes(options: {
  applicationSecret: string;
  auth: Auth;
  database: DatabaseConnection;
  policyCache?: IamPermissionCache;
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
    .get("/administration", async ({ query, request }) => {
      const access = await privilegedActor(request);
      if (access.response) return access.response;
      if (query.organizationId === undefined) {
        try {
          const [services, organizations] = await Promise.all([
            listAvailableServices(options.database),
            listManagedOrganizations(options.database, access.actor!),
          ]);
          return { organizations, services };
        } catch (error) {
          return grantProblem(error);
        }
      }
      if (typeof query.organizationId !== "string" || !validUuid(query.organizationId))
        return problem(400, "invalid_request", "Invalid organization scope");
      try {
        const [detail, grants] = await Promise.all([
          getOrganizationAdministration(options.database, query.organizationId, access.actor!),
          listServiceGrants(
            options.database,
            { organizationId: query.organizationId },
            access.actor!,
          ),
        ]);
        return { detail, grants };
      } catch (error) {
        return grantProblem(error);
      }
    })
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
        await options.policyCache?.invalidateScope(
          { organizationId: grant.organizationId, service: grant.service },
          `${access.actor!.requestId}:service-grant-create`,
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
        const grant = await setServiceGrantActive(
          options.database,
          { active: input.active, grantId: params.id },
          access.actor!,
        );
        await options.policyCache?.invalidateScope(
          { organizationId: grant.organizationId, service: grant.service },
          `${access.actor!.requestId}:service-grant-status`,
        );
        return grant;
      } catch (error) {
        return grantProblem(error);
      }
    })
    .delete("/:id", async ({ params, request }) => {
      const access = await privilegedActor(request);
      if (access.response) return access.response;
      if (!validUuid(params.id)) return problem(400, "invalid_request", "Invalid service grant");
      try {
        const grant = await revokeServiceGrant(options.database, params.id, access.actor!);
        await options.policyCache?.invalidateScope(
          { organizationId: grant.organizationId, service: grant.service },
          `${access.actor!.requestId}:service-grant-revoke`,
        );
        return new Response(null, { status: 204 });
      } catch (error) {
        return grantProblem(error);
      }
    });
}
