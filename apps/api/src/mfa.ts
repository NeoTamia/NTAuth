import { verifyPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { Elysia } from "elysia";

import {
  account,
  beginMfaEnrollment,
  enforcePlatformAdminMfa,
  InvalidMfaChallengeError,
  MfaEnrollmentAuthorizationError,
  MfaEnrollmentRequiredError,
  verifyMfaEnrollment,
  type DatabaseConnection,
} from "@neotamia/db";

import type { createAuth } from "./auth/auth";

type Auth = ReturnType<typeof createAuth>;

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
  actor: { requestId: string; userId: string },
) {
  await enforcePlatformAdminMfa(database, {
    applicationSecret,
    code: request.headers.get("x-ntauth-totp") ?? undefined,
    requestId: actor.requestId,
    userId: actor.userId,
  });
}

export function createMfaRoutes(options: {
  applicationSecret: string;
  auth: Auth;
  database: DatabaseConnection;
}) {
  return new Elysia({ prefix: "/api/v1/mfa" })
    .post("/enroll", async ({ body, request }) => {
      const current = await options.auth.api.getSession({ headers: request.headers });
      if (!current) return new Response(null, { status: 401 });
      const input =
        body && typeof body === "object" ? (body as Record<string, unknown>) : undefined;
      if (typeof input?.password !== "string") return new Response(null, { status: 400 });
      const [credential] = await options.database.db
        .select({ password: account.password })
        .from(account)
        .where(and(eq(account.userId, current.user.id), eq(account.providerId, "credential")))
        .limit(1);
      if (
        !credential?.password ||
        !(await verifyPassword({ hash: credential.password, password: input.password }))
      )
        return new Response(null, { status: 403 });
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
          return new Response(null, { status: 403 });
        throw error;
      }
    })
    .post("/verify", async ({ body, request }) => {
      const current = await options.auth.api.getSession({ headers: request.headers });
      if (!current) return new Response(null, { status: 401 });
      const input =
        body && typeof body === "object" ? (body as Record<string, unknown>) : undefined;
      if (typeof input?.code !== "string") return new Response(null, { status: 400 });
      try {
        await verifyMfaEnrollment(options.database, {
          applicationSecret: options.applicationSecret,
          code: input.code,
          requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
          userId: current.user.id,
        });
        return Response.json({ status: "verified" });
      } catch (error) {
        return mfaProblem(error) ?? new Response(null, { status: 400 });
      }
    });
}
