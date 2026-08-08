import { Elysia } from "elysia";

import {
  createIamPolicy,
  createIamPolicyVersion,
  getIamPolicyHistory,
  IamPolicyAuthorizationError,
  IamPolicyConflictError,
  IamPolicyNotFoundError,
  IamPolicyValidationError,
  rollbackIamPolicy,
  setIamPolicyStatus,
  type DatabaseConnection,
  type IamPolicyStatus,
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

function bodyObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function policyProblem(error: unknown) {
  if (error instanceof IamPolicyAuthorizationError)
    return problem(403, "forbidden", "IAM policy operation not permitted");
  if (error instanceof IamPolicyNotFoundError)
    return problem(404, "policy_not_found", "IAM policy not found");
  if (error instanceof IamPolicyConflictError)
    return problem(409, "policy_conflict", "IAM policy conflicts with current state");
  if (error instanceof IamPolicyValidationError)
    return problem(422, "invalid_policy", "IAM policy document is invalid");
  return problem(500, "internal_error", "IAM policy operation failed");
}

export function createIamPolicyRoutes(options: {
  applicationSecret: string;
  auth: Auth;
  database: DatabaseConnection;
  policyCache?: IamPermissionCache;
}) {
  const actor = async (request: Request) => {
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
    const current = await options.auth.api.getSession({ headers: request.headers });
    if (!current)
      return { response: problem(401, "authentication_required", "Authentication required") };
    const authenticated = { requestId, userId: current.user.id };
    try {
      await enforceRequestMfa(options.database, options.applicationSecret, request, authenticated);
      return { actor: authenticated };
    } catch (error) {
      return { response: mfaProblem(error) ?? problem(403, "forbidden", "MFA challenge failed") };
    }
  };

  return new Elysia()
    .post("/api/v1/iam/policies", async ({ body, request }) => {
      const access = await actor(request);
      if (access.response) return access.response;
      const input = bodyObject(body);
      if (
        typeof input?.organizationId !== "string" ||
        !validUuid(input.organizationId) ||
        typeof input.service !== "string" ||
        typeof input.name !== "string" ||
        input.name.trim().length === 0 ||
        input.name.length > 160 ||
        input.document === undefined
      ) {
        return problem(400, "invalid_request", "Invalid IAM policy request");
      }
      try {
        const result = await createIamPolicy(
          options.database,
          {
            document: input.document,
            name: input.name,
            organizationId: input.organizationId,
            service: input.service,
          },
          access.actor!,
        );
        await options.policyCache?.invalidateScope(
          { organizationId: result.policy.organizationId, service: result.policy.service },
          `${access.actor!.requestId}:policy-create`,
        );
        return Response.json(result, { status: 201 });
      } catch (error) {
        return policyProblem(error);
      }
    })
    .put("/api/v1/iam/policies/:id", async ({ body, params, request }) => {
      const access = await actor(request);
      if (access.response) return access.response;
      const input = bodyObject(body);
      if (
        !validUuid(params.id) ||
        !positiveInteger(input?.expectedVersion) ||
        input.document === undefined
      ) {
        return problem(400, "invalid_request", "Invalid IAM policy version request");
      }
      try {
        const result = await createIamPolicyVersion(
          options.database,
          { document: input.document, expectedVersion: input.expectedVersion, policyId: params.id },
          access.actor!,
        );
        await options.policyCache?.invalidateScope(
          { organizationId: result.policy.organizationId, service: result.policy.service },
          `${access.actor!.requestId}:policy-version`,
        );
        return result;
      } catch (error) {
        return policyProblem(error);
      }
    })
    .post("/api/v1/iam/policies/:id/rollback", async ({ body, params, request }) => {
      const access = await actor(request);
      if (access.response) return access.response;
      const input = bodyObject(body);
      if (
        !validUuid(params.id) ||
        !positiveInteger(input?.expectedVersion) ||
        !positiveInteger(input.targetVersion)
      ) {
        return problem(400, "invalid_request", "Invalid IAM policy rollback request");
      }
      try {
        const result = await rollbackIamPolicy(
          options.database,
          {
            expectedVersion: input.expectedVersion,
            policyId: params.id,
            targetVersion: input.targetVersion,
          },
          access.actor!,
        );
        await options.policyCache?.invalidateScope(
          { organizationId: result.policy.organizationId, service: result.policy.service },
          `${access.actor!.requestId}:policy-rollback`,
        );
        return result;
      } catch (error) {
        return policyProblem(error);
      }
    })
    .patch("/api/v1/iam/policies/:id/status", async ({ body, params, request }) => {
      const access = await actor(request);
      if (access.response) return access.response;
      const input = bodyObject(body);
      if (
        !validUuid(params.id) ||
        !input ||
        !["active", "inactive"].includes(String(input.status))
      ) {
        return problem(400, "invalid_request", "Invalid IAM policy status request");
      }
      try {
        const policy = await setIamPolicyStatus(
          options.database,
          { policyId: params.id, status: input.status as IamPolicyStatus },
          access.actor!,
        );
        await options.policyCache?.invalidateScope(
          { organizationId: policy.organizationId, service: policy.service },
          `${access.actor!.requestId}:policy-status`,
        );
        return policy;
      } catch (error) {
        return policyProblem(error);
      }
    })
    .get("/api/v1/iam/policies/:id/history", async ({ params, request }) => {
      const access = await actor(request);
      if (access.response) return access.response;
      if (!validUuid(params.id)) return problem(400, "invalid_request", "Invalid IAM policy");
      try {
        return await getIamPolicyHistory(options.database, params.id, access.actor!);
      } catch (error) {
        return policyProblem(error);
      }
    });
}
