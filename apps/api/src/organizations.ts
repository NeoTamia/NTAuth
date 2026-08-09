import { Elysia } from "elysia";

import {
  createOrganization,
  getOrganizationAdministration,
  listManagedOrganizations,
  OrganizationAuthorizationError,
  OrganizationConflictError,
  OrganizationNotFoundError,
  updateOrganization,
  updateOrganizationMember,
  type DatabaseConnection,
  type MembershipStatus,
  type OrganizationRole,
  type OrganizationStatus,
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

function organizationProblem(error: unknown) {
  if (error instanceof OrganizationAuthorizationError)
    return problem(403, "forbidden", "Organization operation not permitted");
  if (error instanceof OrganizationNotFoundError)
    return problem(404, "organization_not_found", "Organization or membership not found");
  if (error instanceof OrganizationConflictError)
    return problem(409, "organization_conflict", error.message);
  return problem(409, "organization_conflict", "Organization change conflicts with current state");
}

export function createOrganizationRoutes(options: {
  applicationSecret: string;
  auth: Auth;
  database: DatabaseConnection;
}) {
  const privilegedActor = async (request: Request) => {
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
    const current = await options.auth.api.getSession({ headers: request.headers });
    if (!current)
      return { response: problem(401, "authentication_required", "Authentication required") };
    const actor = { requestId, sessionId: current.session.id, userId: current.user.id };
    try {
      await enforceRequestMfa(options.database, options.applicationSecret, request, actor);
      return { actor };
    } catch (error) {
      return { response: mfaProblem(error) ?? problem(403, "forbidden", "MFA challenge failed") };
    }
  };

  return new Elysia({ prefix: "/api/v1/organizations" })
    .get("/", async ({ request }) => {
      const access = await privilegedActor(request);
      if (access.response) return access.response;
      return await listManagedOrganizations(options.database, access.actor!);
    })
    .post("/", async ({ body, request }) => {
      const access = await privilegedActor(request);
      if (access.response) return access.response;
      const input = objectBody(body);
      if (
        typeof input?.name !== "string" ||
        input.name.trim().length === 0 ||
        input.name.trim().length > 160 ||
        typeof input.slug !== "string" ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug) ||
        input.slug.length > 80
      )
        return problem(400, "invalid_request", "Invalid organization request");
      try {
        const organization = await createOrganization(
          options.database,
          { name: input.name.trim(), slug: input.slug },
          access.actor!,
        );
        return Response.json(organization, { status: 201 });
      } catch (error) {
        return organizationProblem(error);
      }
    })
    .get("/:id", async ({ params, request }) => {
      const access = await privilegedActor(request);
      if (access.response) return access.response;
      if (!validUuid(params.id)) return problem(400, "invalid_request", "Invalid organization");
      try {
        return await getOrganizationAdministration(options.database, params.id, access.actor!);
      } catch (error) {
        return organizationProblem(error);
      }
    })
    .patch("/:id", async ({ body, params, request }) => {
      const access = await privilegedActor(request);
      if (access.response) return access.response;
      const input = objectBody(body);
      if (
        !validUuid(params.id) ||
        typeof input?.name !== "string" ||
        input.name.trim().length === 0 ||
        input.name.trim().length > 160 ||
        !["active", "suspended"].includes(String(input.status))
      )
        return problem(400, "invalid_request", "Invalid organization update");
      try {
        return await updateOrganization(
          options.database,
          {
            id: params.id,
            name: input.name,
            status: input.status as OrganizationStatus,
          },
          access.actor!,
        );
      } catch (error) {
        return organizationProblem(error);
      }
    })
    .patch("/:id/members/:userId", async ({ body, params, request }) => {
      const access = await privilegedActor(request);
      if (access.response) return access.response;
      const input = objectBody(body);
      if (
        !validUuid(params.id) ||
        !["owner", "admin", "member"].includes(String(input?.role)) ||
        !["active", "suspended"].includes(String(input?.status))
      )
        return problem(400, "invalid_request", "Invalid membership update");
      try {
        return await updateOrganizationMember(
          options.database,
          {
            organizationId: params.id,
            role: input!.role as OrganizationRole,
            status: input!.status as MembershipStatus,
            userId: params.userId,
          },
          access.actor!,
        );
      } catch (error) {
        return organizationProblem(error);
      }
    });
}
