import { Elysia } from "elysia";

import {
  addIamGroupMember,
  attachIamPolicy,
  createIamGroup,
  detachIamPolicy,
  IamAttachmentAuthorizationError,
  IamAttachmentConflictError,
  IamAttachmentNotFoundError,
  listIamPolicyAttachments,
  type DatabaseConnection,
  type IamPrincipalType,
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

function attachmentProblem(error: unknown) {
  if (error instanceof IamAttachmentAuthorizationError)
    return problem(403, "forbidden", "IAM attachment operation not permitted");
  if (error instanceof IamAttachmentNotFoundError)
    return problem(404, "attachment_not_found", "IAM attachment resource not found");
  if (error instanceof IamAttachmentConflictError)
    return problem(409, "attachment_conflict", "IAM attachment conflicts with current state");
  return problem(500, "internal_error", "IAM attachment operation failed");
}

export function createIamAttachmentRoutes(options: {
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
    .post("/api/v1/iam/groups", async ({ body, request }) => {
      const access = await actor(request);
      if (access.response) return access.response;
      const input = bodyObject(body);
      if (
        typeof input?.organizationId !== "string" ||
        !validUuid(input.organizationId) ||
        typeof input.name !== "string" ||
        input.name.trim().length === 0 ||
        input.name.length > 160
      ) {
        return problem(400, "invalid_request", "Invalid IAM group request");
      }
      try {
        return Response.json(
          await createIamGroup(
            options.database,
            { name: input.name, organizationId: input.organizationId },
            access.actor!,
          ),
          { status: 201 },
        );
      } catch (error) {
        return attachmentProblem(error);
      }
    })
    .put("/api/v1/iam/groups/:id/members/:userId", async ({ params, request }) => {
      const access = await actor(request);
      if (access.response) return access.response;
      if (!validUuid(params.id) || params.userId.length === 0)
        return problem(400, "invalid_request", "Invalid IAM group member request");
      try {
        const membership = await addIamGroupMember(
          options.database,
          { groupId: params.id, userId: params.userId },
          access.actor!,
        );
        await options.policyCache?.invalidateGroup(
          membership.groupId,
          `${access.actor!.requestId}:group-member-add`,
        );
        return Response.json(membership, { status: 201 });
      } catch (error) {
        return attachmentProblem(error);
      }
    })
    .post("/api/v1/iam/policies/:id/attachments", async ({ body, params, request }) => {
      const access = await actor(request);
      if (access.response) return access.response;
      const input = bodyObject(body);
      if (
        !validUuid(params.id) ||
        !["user", "group", "role"].includes(String(input?.principalType)) ||
        typeof input?.principalId !== "string" ||
        input.principalId.length === 0
      ) {
        return problem(400, "invalid_request", "Invalid IAM attachment request");
      }
      try {
        const attachment = await attachIamPolicy(
          options.database,
          {
            policyId: params.id,
            principalId: input.principalId,
            principalType: input.principalType as IamPrincipalType,
          },
          access.actor!,
        );
        await options.policyCache?.invalidatePolicy(
          attachment.policyId,
          `${access.actor!.requestId}:policy-attach`,
        );
        return Response.json(attachment, { status: 201 });
      } catch (error) {
        return attachmentProblem(error);
      }
    })
    .get("/api/v1/iam/policies/:id/attachments", async ({ params, request }) => {
      const access = await actor(request);
      if (access.response) return access.response;
      if (!validUuid(params.id)) return problem(400, "invalid_request", "Invalid IAM policy");
      try {
        return await listIamPolicyAttachments(options.database, params.id, access.actor!);
      } catch (error) {
        return attachmentProblem(error);
      }
    })
    .delete("/api/v1/iam/attachments/:id", async ({ params, request }) => {
      const access = await actor(request);
      if (access.response) return access.response;
      if (!validUuid(params.id)) return problem(400, "invalid_request", "Invalid IAM attachment");
      try {
        const attachment = await detachIamPolicy(options.database, params.id, access.actor!);
        await options.policyCache?.invalidatePolicy(
          attachment.policyId,
          `${access.actor!.requestId}:policy-detach`,
        );
        return attachment;
      } catch (error) {
        return attachmentProblem(error);
      }
    });
}
