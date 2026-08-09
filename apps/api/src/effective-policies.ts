import { Elysia } from "elysia";

import {
  EffectivePolicyAuthorizationError,
  EffectivePolicyNotFoundError,
  getEffectivePolicies,
  type DatabaseConnection,
} from "@neotamia/db";

import type { createAuth } from "./auth/auth";
import { authenticateResourceAccessToken } from "./auth/oauth-lifecycle";
import type { IamPermissionCache } from "./iam-cache";
import { enforceRequestMfa, mfaProblem } from "./mfa";

type Auth = ReturnType<typeof createAuth>;

function problem(status: number, code: string, title: string) {
  return new Response(JSON.stringify({ code, status, title, type: `urn:ntauth:error:${code}` }), {
    headers: { "content-type": "application/problem+json" },
    status,
  });
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function matchesIfNoneMatch(header: string | null, etag: string) {
  if (!header) return false;
  const normalizedEtag = etag.replace(/^W\//, "");
  return header
    .split(",")
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === "*" || candidate.replace(/^W\//, "") === normalizedEtag);
}

export function createEffectivePolicyRoutes(options: {
  applicationSecret: string;
  auth: Auth;
  database: DatabaseConnection;
  policyCache?: IamPermissionCache;
}) {
  return new Elysia().get("/api/v1/iam/effective-policies", async ({ query, request }) => {
    const bearer = request.headers.get("authorization")?.startsWith("Bearer ") === true;
    const current = bearer
      ? undefined
      : await options.auth.api.getSession({ headers: request.headers });
    if (!bearer && !current)
      return problem(401, "authentication_required", "Authentication required");
    const organizationId = query.organization_id;
    const service = query.service;
    if (
      typeof organizationId !== "string" ||
      !validUuid(organizationId) ||
      typeof service !== "string" ||
      !/^[a-z][a-z0-9-]{0,62}$/.test(service)
    ) {
      return problem(400, "invalid_request", "Invalid effective policy query");
    }
    const access = bearer
      ? await authenticateResourceAccessToken(options.auth, options.database, request)
      : undefined;
    if (access instanceof Response) return access;
    if (access && (access.organization_id !== organizationId || access.service !== service)) {
      return problem(403, "forbidden", "Effective policies are not available");
    }
    const userId = access?.sub ?? current?.user.id;
    if (typeof userId !== "string")
      return problem(401, "authentication_required", "Authentication required");
    try {
      if (!bearer) {
        await enforceRequestMfa(options.database, options.applicationSecret, request, {
          requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
          sessionId: current!.session.id,
          userId,
        });
      }
      const effective = await (options.policyCache?.get({
        organizationId,
        service,
        userId,
      }) ??
        getEffectivePolicies(options.database, {
          organizationId,
          service,
          userId,
        }));
      if (matchesIfNoneMatch(request.headers.get("if-none-match"), effective.etag)) {
        return new Response(null, { headers: { etag: effective.etag }, status: 304 });
      }
      return Response.json(effective, { headers: { etag: effective.etag } });
    } catch (error) {
      const mfa = mfaProblem(error);
      if (mfa) return mfa;
      if (error instanceof EffectivePolicyAuthorizationError)
        return problem(403, "forbidden", "Effective policies are not available");
      if (error instanceof EffectivePolicyNotFoundError)
        return problem(404, "service_not_found", "IAM service not found");
      return problem(500, "internal_error", "Effective policy resolution failed");
    }
  });
}
