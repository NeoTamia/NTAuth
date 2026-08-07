import { Elysia } from "elysia";

import {
  deleteUser,
  InvalidUserLifecycleTransitionError,
  setUserStatus,
  UserLifecycleAuthorizationError,
  UserLifecycleNotFoundError,
  type DatabaseConnection,
  type ReversibleUserStatus,
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

async function actorFrom(auth: Auth, headers: Headers, requestId: string) {
  const current = await auth.api.getSession({ headers });
  return current ? { requestId, userId: current.user.id } : undefined;
}

function lifecycleProblem(error: unknown) {
  if (error instanceof UserLifecycleAuthorizationError)
    return problem(403, "forbidden", "User lifecycle change not permitted");
  if (error instanceof UserLifecycleNotFoundError)
    return problem(404, "user_not_found", "User not found");
  if (error instanceof InvalidUserLifecycleTransitionError)
    return problem(409, "invalid_user_transition", "User lifecycle transition is invalid");
  return problem(500, "internal_error", "User lifecycle change failed");
}

export function createUserRoutes(options: {
  applicationSecret: string;
  auth: Auth;
  database: DatabaseConnection;
}) {
  return new Elysia({ prefix: "/api/v1/users" })
    .patch("/:id/status", async ({ body, params, request }) => {
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

      const input =
        body && typeof body === "object" ? (body as Record<string, unknown>) : undefined;
      if (!input || !["active", "deactivated", "suspended"].includes(String(input.status)))
        return problem(400, "invalid_request", "Invalid user status");

      try {
        const updated = await setUserStatus(
          options.database,
          { status: input.status as ReversibleUserStatus, userId: params.id },
          actor,
        );
        return Response.json(updated);
      } catch (error) {
        return lifecycleProblem(error);
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
        await deleteUser(options.database, params.id, actor);
        return new Response(null, { status: 204 });
      } catch (error) {
        return lifecycleProblem(error);
      }
    });
}
