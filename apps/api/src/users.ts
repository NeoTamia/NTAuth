import { Elysia } from "elysia";

import {
  deleteUser,
  getPlatformUserAdministration,
  InvalidUserLifecycleTransitionError,
  listPlatformUsers,
  revokeUserSessions,
  SessionRevocationAuthorizationError,
  setUserStatus,
  UserLifecycleAuthorizationError,
  UserLifecycleNotFoundError,
  type DatabaseConnection,
  type ReversibleUserStatus,
  type UserStatus,
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
  return current
    ? { requestId, sessionId: current.session.id, userId: current.user.id }
    : undefined;
}

function lifecycleProblem(error: unknown) {
  if (error instanceof UserLifecycleAuthorizationError)
    return problem(403, "forbidden", "User lifecycle change not permitted");
  if (error instanceof UserLifecycleNotFoundError)
    return problem(404, "user_not_found", "User not found");
  if (error instanceof InvalidUserLifecycleTransitionError)
    return problem(409, "invalid_user_transition", "User lifecycle transition is invalid");
  if (error instanceof SessionRevocationAuthorizationError)
    return problem(403, "forbidden", "Session revocation not permitted");
  return problem(500, "internal_error", "User lifecycle change failed");
}

export function createUserRoutes(options: {
  applicationSecret: string;
  auth: Auth;
  database: DatabaseConnection;
}) {
  const privilegedActor = async (request: Request) => {
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
    const actor = await actorFrom(options.auth, request.headers, requestId);
    if (!actor)
      return { response: problem(401, "authentication_required", "Authentication required") };
    try {
      await enforceRequestMfa(options.database, options.applicationSecret, request, actor);
      return { actor };
    } catch (error) {
      return {
        response: mfaProblem(error) ?? problem(403, "forbidden", "MFA challenge failed"),
      };
    }
  };

  return new Elysia({ prefix: "/api/v1/users" })
    .get("/", async ({ query, request }) => {
      const access = await privilegedActor(request);
      if (access.response) return access.response;
      const limit = query.limit === undefined ? 20 : Number(query.limit);
      const offset = query.offset === undefined ? 0 : Number(query.offset);
      const search = typeof query.query === "string" ? query.query.trim() : "";
      const status = query.status;
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 50 ||
        !Number.isInteger(offset) ||
        offset < 0 ||
        search.length > 160 ||
        (status !== undefined &&
          !["active", "deactivated", "deleted", "suspended"].includes(status))
      )
        return problem(400, "invalid_request", "Invalid user registry query");
      try {
        return await listPlatformUsers(
          options.database,
          {
            limit,
            offset,
            query: search || undefined,
            status: status as UserStatus | undefined,
          },
          access.actor!,
        );
      } catch (error) {
        return lifecycleProblem(error);
      }
    })
    .get("/:id", async ({ params, request }) => {
      const access = await privilegedActor(request);
      if (access.response) return access.response;
      try {
        return await getPlatformUserAdministration(options.database, params.id, access.actor!);
      } catch (error) {
        return lifecycleProblem(error);
      }
    })
    .post("/:id/sessions/revoke", async ({ body, params, request }) => {
      const access = await privilegedActor(request);
      if (access.response) return access.response;
      const input =
        body && typeof body === "object" ? (body as Record<string, unknown>) : undefined;
      if (!input || !["administrative", "compromised"].includes(String(input.reason)))
        return problem(400, "invalid_request", "Invalid session revocation request");
      try {
        const revokedCount = await revokeUserSessions(
          options.database,
          { reason: input.reason as "administrative" | "compromised", userId: params.id },
          access.actor!,
        );
        return { revokedCount };
      } catch (error) {
        return lifecycleProblem(error);
      }
    })
    .patch("/:id/status", async ({ body, params, request }) => {
      const access = await privilegedActor(request);
      if (access.response) return access.response;

      const input =
        body && typeof body === "object" ? (body as Record<string, unknown>) : undefined;
      if (!input || !["active", "deactivated", "suspended"].includes(String(input.status)))
        return problem(400, "invalid_request", "Invalid user status");

      try {
        const updated = await setUserStatus(
          options.database,
          { status: input.status as ReversibleUserStatus, userId: params.id },
          access.actor!,
        );
        return Response.json(updated);
      } catch (error) {
        return lifecycleProblem(error);
      }
    })
    .delete("/:id", async ({ params, request }) => {
      const access = await privilegedActor(request);
      if (access.response) return access.response;

      try {
        await deleteUser(options.database, params.id, access.actor!);
        return new Response(null, { status: 204 });
      } catch (error) {
        return lifecycleProblem(error);
      }
    });
}
