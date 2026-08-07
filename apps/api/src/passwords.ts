import { hashPassword, verifyPassword } from "better-auth/crypto";
import { Elysia } from "elysia";

import {
  changePassword,
  completePasswordReset,
  InvalidCurrentPasswordError,
  InvalidPasswordResetError,
  requestPasswordReset,
  type DatabaseConnection,
} from "@neotamia/db";

import type { createAuth } from "./auth/auth";

type Auth = ReturnType<typeof createAuth>;
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 128;

function problem(status: number, code: string, title: string) {
  return new Response(JSON.stringify({ code, status, title, type: `urn:ntauth:error:${code}` }), {
    headers: { "content-type": "application/problem+json" },
    status,
  });
}

function bodyOf(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX;
}

export function createPasswordRoutes(options: {
  auth: Auth;
  database: DatabaseConnection;
  resetPasswordURL: string;
}) {
  return new Elysia({ prefix: "/api/v1/password" })
    .post("/forgot", async ({ body }) => {
      const input = bodyOf(body);
      if (typeof input?.email !== "string")
        return problem(400, "invalid_request", "Invalid password reset request");
      await requestPasswordReset(options.database, {
        email: input.email,
        resetBaseURL: options.resetPasswordURL,
      });
      return Response.json({ status: "accepted" }, { status: 202 });
    })
    .post("/reset", async ({ body }) => {
      const input = bodyOf(body);
      if (typeof input?.token !== "string" || !validPassword(input.password))
        return problem(400, "invalid_password_reset", "Password reset is invalid or unavailable");
      try {
        await completePasswordReset(options.database, {
          passwordHash: await hashPassword(input.password),
          token: input.token,
        });
        return Response.json({ status: "changed" });
      } catch (error) {
        if (error instanceof InvalidPasswordResetError)
          return problem(400, "invalid_password_reset", "Password reset is invalid or unavailable");
        return problem(400, "invalid_password_reset", "Password reset is invalid or unavailable");
      }
    })
    .post("/change", async ({ body, request }) => {
      const current = await options.auth.api.getSession({ headers: request.headers });
      if (!current) return problem(401, "authentication_required", "Authentication required");
      const input = bodyOf(body);
      if (typeof input?.currentPassword !== "string" || !validPassword(input.password))
        return problem(400, "invalid_request", "Invalid password change request");
      try {
        await changePassword(
          options.database,
          {
            currentPassword: input.currentPassword,
            passwordHash: await hashPassword(input.password),
            verify: verifyPassword,
          },
          {
            requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
            userId: current.user.id,
          },
        );
        return Response.json({ status: "changed" });
      } catch (error) {
        if (error instanceof InvalidCurrentPasswordError)
          return problem(400, "invalid_current_password", "Current password is invalid");
        return problem(400, "password_change_failed", "Password could not be changed");
      }
    });
}
