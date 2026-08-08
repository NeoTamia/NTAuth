import { hashPassword } from "better-auth/crypto";
import { Elysia } from "elysia";

import {
  acceptInvitation,
  cancelInvitation,
  createInvitation,
  getInvitationPreview,
  InvalidInvitationError,
  InvitationAuthorizationError,
  type DatabaseConnection,
  type OrganizationRole,
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
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

async function actorFrom(auth: Auth, headers: Headers, requestId: string) {
  const current = await auth.api.getSession({ headers });
  return current ? { requestId, userId: current.user.id } : undefined;
}

function maskEmail(email: string): string {
  const separator = email.lastIndexOf("@");
  if (separator <= 0) return "***";
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  return `${local.slice(0, 1)}${"*".repeat(Math.min(Math.max(local.length - 1, 3), 8))}@${domain}`;
}

export function createInvitationRoutes(options: {
  acceptInvitationURL: string;
  applicationSecret: string;
  auth: Auth;
  database: DatabaseConnection;
}) {
  return new Elysia({ prefix: "/api/v1/invitations" })
    .get("/validate", async ({ query }) => {
      if (typeof query.token !== "string" || query.token.length < 32)
        return problem(400, "invalid_invitation", "Invitation is invalid or unavailable");

      try {
        const invitation = await getInvitationPreview(options.database, query.token);
        return Response.json({
          email: maskEmail(invitation.email),
          expiresAt: invitation.expiresAt.toISOString(),
          organizationName: invitation.organizationName,
          role: invitation.role,
        });
      } catch (error) {
        if (error instanceof InvalidInvitationError)
          return problem(400, "invalid_invitation", "Invitation is invalid or unavailable");
        return problem(400, "invalid_invitation", "Invitation is invalid or unavailable");
      }
    })
    .post("/", async ({ body, request }) => {
      const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
      const actor = await actorFrom(options.auth, request.headers, requestId);
      if (!actor) return problem(401, "authentication_required", "Authentication required");
      try {
        await enforceRequestMfa(options.database, options.applicationSecret, request, actor);
      } catch (error) {
        const response = mfaProblem(error);
        if (response) return response;
        throw error;
      }

      const input = objectBody(body);
      const email = input?.email;
      const organizationId = input?.organizationId;
      const role = input?.role;
      if (
        typeof email !== "string" ||
        typeof organizationId !== "string" ||
        !["owner", "admin", "member"].includes(String(role))
      )
        return problem(400, "invalid_request", "Invalid invitation request");

      try {
        const invitation = await createInvitation(
          options.database,
          {
            email,
            invitationBaseURL: options.acceptInvitationURL,
            organizationId,
            role: role as OrganizationRole,
          },
          actor,
        );
        return Response.json(
          { expiresAt: invitation.expiresAt.toISOString(), id: invitation.id },
          { status: 201 },
        );
      } catch (error) {
        if (error instanceof InvitationAuthorizationError)
          return problem(403, "forbidden", "Invitation not permitted");
        return problem(409, "invitation_conflict", "Invitation could not be created");
      }
    })
    .post("/accept", async ({ body }) => {
      const input = objectBody(body);
      if (
        typeof input?.name !== "string" ||
        input.name.trim().length === 0 ||
        input.name.trim().length > 100 ||
        typeof input.password !== "string" ||
        typeof input.token !== "string" ||
        input.password.length < 12 ||
        input.password.length > 128
      )
        return problem(400, "invalid_invitation", "Invitation is invalid or unavailable");

      try {
        await acceptInvitation(options.database, {
          name: input.name.trim(),
          passwordHash: await hashPassword(input.password),
          token: input.token,
        });
        return Response.json({ status: "accepted" });
      } catch (error) {
        if (error instanceof InvalidInvitationError)
          return problem(400, "invalid_invitation", "Invitation is invalid or unavailable");
        return problem(400, "invalid_invitation", "Invitation is invalid or unavailable");
      }
    })
    .delete("/:id", async ({ params, request }) => {
      const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
      const actor = await actorFrom(options.auth, request.headers, requestId);
      if (!actor) return problem(401, "authentication_required", "Authentication required");
      try {
        await enforceRequestMfa(options.database, options.applicationSecret, request, actor);
      } catch (error) {
        const response = mfaProblem(error);
        if (response) return response;
        throw error;
      }

      try {
        await cancelInvitation(options.database, params.id, actor);
        return new Response(null, { status: 204 });
      } catch (error) {
        if (error instanceof InvitationAuthorizationError)
          return problem(403, "forbidden", "Invitation not permitted");
        return problem(404, "invitation_not_found", "Invitation not found");
      }
    });
}
