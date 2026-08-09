import { Elysia } from "elysia";

import {
  createIamCatalogEntry,
  createService,
  getServiceCatalogue,
  IamCatalogAuthorizationError,
  IamCatalogConflictError,
  IamCatalogNotFoundError,
  listAvailableServices,
  listIamCatalogueAdministration,
  setIamCatalogEntryStatus,
  updateService,
  type DatabaseConnection,
  type IamCatalogKind,
  type ServiceStatus,
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

function bodyObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function publicCatalogueEntry(entry: { description: string | null; identifier: string }) {
  return { description: entry.description, identifier: entry.identifier };
}

function catalogueProblem(error: unknown) {
  if (error instanceof IamCatalogAuthorizationError)
    return problem(403, "forbidden", "IAM catalogue operation not permitted");
  if (error instanceof IamCatalogNotFoundError)
    return problem(404, "catalogue_not_found", "IAM catalogue resource not found");
  if (error instanceof IamCatalogConflictError)
    return problem(409, "catalogue_conflict", "IAM catalogue conflicts with current state");
  return problem(500, "internal_error", "IAM catalogue operation failed");
}

export function createIamCatalogRoutes(options: {
  applicationSecret: string;
  auth: Auth;
  database: DatabaseConnection;
}) {
  const actor = async (request: Request) => {
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
    const current = await options.auth.api.getSession({ headers: request.headers });
    if (!current)
      return { response: problem(401, "authentication_required", "Authentication required") };
    const authenticated = {
      requestId,
      sessionId: current.session.id,
      userId: current.user.id,
    };
    try {
      await enforceRequestMfa(options.database, options.applicationSecret, request, authenticated);
      return { actor: authenticated };
    } catch (error) {
      return { response: mfaProblem(error) ?? problem(403, "forbidden", "MFA challenge failed") };
    }
  };

  return new Elysia()
    .get("/api/v1/services", async ({ request }) => {
      const access = await actor(request);
      if (access.response) return access.response;
      return await listAvailableServices(options.database);
    })
    .post("/api/v1/services", async ({ body, request }) => {
      const access = await actor(request);
      if (access.response) return access.response;
      const input = bodyObject(body);
      if (
        typeof input?.key !== "string" ||
        !/^[a-z][a-z0-9-]{0,62}$/.test(input.key) ||
        typeof input.name !== "string" ||
        input.name.trim().length === 0 ||
        input.name.length > 160 ||
        typeof input.ownerUserId !== "string"
      ) {
        return problem(400, "invalid_request", "Invalid service request");
      }
      try {
        return Response.json(
          await createService(
            options.database,
            { key: input.key, name: input.name.trim(), ownerUserId: input.ownerUserId },
            access.actor!,
          ),
          { status: 201 },
        );
      } catch (error) {
        return catalogueProblem(error);
      }
    })
    .patch("/api/v1/services/:key", async ({ body, params, request }) => {
      const access = await actor(request);
      if (access.response) return access.response;
      const input = bodyObject(body);
      if (
        !/^[a-z][a-z0-9-]{0,62}$/.test(params.key) ||
        (input?.name !== undefined &&
          (typeof input.name !== "string" ||
            input.name.trim().length === 0 ||
            input.name.length > 160)) ||
        (input?.ownerUserId !== undefined && typeof input.ownerUserId !== "string") ||
        (input?.status !== undefined && !["active", "inactive"].includes(String(input.status)))
      ) {
        return problem(400, "invalid_request", "Invalid service update");
      }
      try {
        return await updateService(
          options.database,
          {
            key: params.key,
            name: input?.name as string | undefined,
            ownerUserId: input?.ownerUserId as string | undefined,
            status: input?.status as ServiceStatus | undefined,
          },
          access.actor!,
        );
      } catch (error) {
        return catalogueProblem(error);
      }
    })
    .get("/api/v1/iam/catalog", async ({ request }) => {
      const access = await actor(request);
      if (access.response) return access.response;
      try {
        return await listIamCatalogueAdministration(options.database, access.actor!);
      } catch (error) {
        return catalogueProblem(error);
      }
    })
    .post("/api/v1/iam/catalog", async ({ body, request }) => {
      const access = await actor(request);
      if (access.response) return access.response;
      const input = bodyObject(body);
      if (
        typeof input?.service !== "string" ||
        typeof input.identifier !== "string" ||
        !["action", "resource"].includes(String(input.kind)) ||
        (input.description !== undefined &&
          (typeof input.description !== "string" || input.description.length > 500))
      ) {
        return problem(400, "invalid_request", "Invalid catalogue entry request");
      }
      try {
        return Response.json(
          await createIamCatalogEntry(
            options.database,
            {
              description: input.description as string | undefined,
              identifier: input.identifier,
              kind: input.kind as IamCatalogKind,
              service: input.service,
            },
            access.actor!,
          ),
          { status: 201 },
        );
      } catch (error) {
        return catalogueProblem(error);
      }
    })
    .patch("/api/v1/iam/catalog/:id", async ({ body, params, request }) => {
      const access = await actor(request);
      if (access.response) return access.response;
      const input = bodyObject(body);
      if (!input || !["active", "inactive"].includes(String(input.status))) {
        return problem(400, "invalid_request", "Invalid catalogue entry status");
      }
      try {
        return await setIamCatalogEntryStatus(
          options.database,
          { entryId: params.id, status: input.status as ServiceStatus },
          access.actor!,
        );
      } catch (error) {
        return catalogueProblem(error);
      }
    })
    .get("/api/v1/iam/catalog/:service", async ({ params }) => {
      try {
        const catalogue = await getServiceCatalogue(options.database, params.service);
        return {
          actions: catalogue.actions.map(publicCatalogueEntry),
          resources: catalogue.resources.map(publicCatalogueEntry),
          service: { key: catalogue.service.key, name: catalogue.service.name },
        };
      } catch (error) {
        return catalogueProblem(error);
      }
    });
}
