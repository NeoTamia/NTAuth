import { verifyPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { Elysia } from "elysia";

import {
  account,
  beginMfaEnrollment,
  enforcePlatformAdminMfa,
  InvalidMfaChallengeError,
  mfaEnrollments,
  MfaEnrollmentAuthorizationError,
  MfaEnrollmentRequiredError,
  platformRoleAssignments,
  session,
  verifyMfaEnrollment,
  type DatabaseConnection,
} from "@neotamia/db";

import type { createAuth } from "./auth/auth";

type Auth = ReturnType<typeof createAuth>;

function problem(status: number, code: string, title: string) {
  return new Response(JSON.stringify({ code, status, title, type: `urn:ntauth:error:${code}` }), {
    headers: { "content-type": "application/problem+json" },
    status,
  });
}

export function mfaProblem(error: unknown) {
  if (error instanceof MfaEnrollmentRequiredError)
    return new Response(
      JSON.stringify({
        code: "mfa_enrollment_required",
        status: 428,
        title: "TOTP enrollment required",
        type: "urn:ntauth:error:mfa_enrollment_required",
      }),
      { headers: { "content-type": "application/problem+json" }, status: 428 },
    );
  if (error instanceof InvalidMfaChallengeError)
    return new Response(
      JSON.stringify({
        code: "invalid_mfa_challenge",
        status: 403,
        title: "TOTP challenge required",
        type: "urn:ntauth:error:invalid_mfa_challenge",
      }),
      { headers: { "content-type": "application/problem+json" }, status: 403 },
    );
  return undefined;
}

export async function enforceRequestMfa(
  database: DatabaseConnection,
  applicationSecret: string,
  request: Request,
  actor: { requestId: string; sessionId: string; userId: string },
) {
  await enforcePlatformAdminMfa(database, {
    applicationSecret,
    code: request.headers.get("x-ntauth-totp") ?? undefined,
    requestId: actor.requestId,
    sessionId: actor.sessionId,
    userId: actor.userId,
  });
}

export function createMfaRoutes(options: {
  applicationSecret: string;
  auth: Auth;
  database: DatabaseConnection;
}) {
  return new Elysia({ prefix: "/api/v1/mfa" })
    .get("/status", async ({ request }) => {
      const current = await options.auth.api.getSession({ headers: request.headers });
      if (!current) return problem(401, "authentication_required", "Authentication required");

      const [role] = await options.database.db
        .select({ userId: platformRoleAssignments.userId })
        .from(platformRoleAssignments)
        .where(eq(platformRoleAssignments.userId, current.user.id))
        .limit(1);
      if (!role) return problem(403, "forbidden", "MFA enrollment not permitted");

      const [enrollment] = await options.database.db
        .select({ verifiedAt: mfaEnrollments.verifiedAt })
        .from(mfaEnrollments)
        .where(eq(mfaEnrollments.userId, current.user.id))
        .limit(1);
      const [activeSession] = await options.database.db
        .select({ mfaVerifiedUntil: session.mfaVerifiedUntil })
        .from(session)
        .where(and(eq(session.id, current.session.id), eq(session.userId, current.user.id)))
        .limit(1);
      const now = new Date();
      return Response.json({
        elevatedUntil:
          activeSession?.mfaVerifiedUntil && activeSession.mfaVerifiedUntil > now
            ? activeSession.mfaVerifiedUntil.toISOString()
            : null,
        status: !enrollment ? "not_enrolled" : enrollment.verifiedAt ? "verified" : "pending",
      });
    })
    .post("/enroll", async ({ body, request }) => {
      const current = await options.auth.api.getSession({ headers: request.headers });
      if (!current) return problem(401, "authentication_required", "Authentication required");
      const input =
        body && typeof body === "object" ? (body as Record<string, unknown>) : undefined;
      if (typeof input?.password !== "string")
        return problem(400, "invalid_request", "Password is required");
      const [credential] = await options.database.db
        .select({ password: account.password })
        .from(account)
        .where(and(eq(account.userId, current.user.id), eq(account.providerId, "credential")))
        .limit(1);
      if (
        !credential?.password ||
        !(await verifyPassword({ hash: credential.password, password: input.password }))
      )
        return problem(403, "invalid_current_password", "Current password is invalid");
      try {
        return Response.json(
          await beginMfaEnrollment(options.database, {
            applicationSecret: options.applicationSecret,
            issuer: "NTAuth",
            userId: current.user.id,
          }),
        );
      } catch (error) {
        if (error instanceof MfaEnrollmentAuthorizationError)
          return problem(403, "forbidden", "MFA enrollment not permitted");
        throw error;
      }
    })
    .post("/verify", async ({ body, request }) => {
      const current = await options.auth.api.getSession({ headers: request.headers });
      if (!current) return problem(401, "authentication_required", "Authentication required");
      const input =
        body && typeof body === "object" ? (body as Record<string, unknown>) : undefined;
      if (typeof input?.code !== "string" || !/^\d{6}$/.test(input.code))
        return problem(400, "invalid_mfa_challenge", "A six-digit TOTP code is required");
      try {
        await verifyMfaEnrollment(options.database, {
          applicationSecret: options.applicationSecret,
          code: input.code,
          requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
          sessionId: current.session.id,
          userId: current.user.id,
        });
        return Response.json({ status: "verified" });
      } catch (error) {
        return mfaProblem(error) ?? new Response(null, { status: 400 });
      }
    });
}
