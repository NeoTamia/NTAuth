import { desc, eq, notInArray } from "drizzle-orm";
import { Elysia } from "elysia";

import { auditEvents, jwks, type DatabaseConnection } from "@neotamia/db";

import type { createAuth } from "./auth/auth";
import { enforceRequestMfa, mfaProblem } from "./mfa";

type Auth = ReturnType<typeof createAuth>;

function problem(status: number, code: string, title: string) {
  return new Response(JSON.stringify({ code, status, title, type: `urn:ntauth:error:${code}` }), {
    headers: { "content-type": "application/problem+json" },
    status,
  });
}

export function createSigningKeyRoutes(options: {
  applicationSecret: string;
  auth: Auth;
  database: DatabaseConnection;
}) {
  return new Elysia({ prefix: "/api/v1/oauth/signing-keys" }).post(
    "/rotate",
    async ({ body, request }) => {
      const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
      const current = await options.auth.api.getSession({ headers: request.headers });
      if (!current) return problem(401, "authentication_required", "Authentication required");
      try {
        await enforceRequestMfa(options.database, options.applicationSecret, request, {
          requestId,
          sessionId: current.session.id,
          userId: current.user.id,
        });
      } catch (error) {
        return mfaProblem(error) ?? problem(403, "forbidden", "Signing-key rotation denied");
      }
      const input =
        body && typeof body === "object" ? (body as Record<string, unknown>) : undefined;
      if (input?.reason !== "emergency")
        return problem(400, "invalid_request", "Emergency rotation reason is required");

      const existingKeys = await options.database.db
        .select()
        .from(jwks)
        .orderBy(desc(jwks.createdAt));
      const [previous] = existingKeys;
      if (!previous) return problem(409, "signing_key_missing", "No signing key to rotate");

      const expiredAt = new Date();
      await options.database.db
        .update(jwks)
        .set({ expiresAt: expiredAt })
        .where(eq(jwks.id, previous.id));
      try {
        const issuedAt = Math.floor(expiredAt.getTime() / 1000);
        await options.auth.api.signJWT({
          body: {
            payload: {
              exp: issuedAt + 60,
              iat: issuedAt,
              jti: `rotation:${crypto.randomUUID()}`,
              sub: "ntauth-key-rotation",
            },
          },
        });
        const [next] = await options.database.db
          .select()
          .from(jwks)
          .where(
            notInArray(
              jwks.id,
              existingKeys.map((key) => key.id),
            ),
          )
          .orderBy(desc(jwks.createdAt))
          .limit(1);
        if (!next) throw new Error("Signing key generation failed");
        await options.database.db.insert(auditEvents).values({
          action: "oauth.signing-key.rotate",
          actorUserId: current.user.id,
          metadata: { mode: "emergency", nextKid: next.id, previousKid: previous.id },
          outcome: "success",
          requestId,
          resourceId: next.id,
          resourceType: "oauth_signing_key",
        });
        return Response.json({ currentKid: next.id, previousKid: previous.id });
      } catch {
        await options.database.db
          .update(jwks)
          .set({ expiresAt: previous.expiresAt })
          .where(eq(jwks.id, previous.id));
        await options.database.db.insert(auditEvents).values({
          action: "oauth.signing-key.rotate",
          actorUserId: current.user.id,
          metadata: { mode: "emergency", previousKid: previous.id },
          outcome: "denied",
          requestId,
          resourceId: previous.id,
          resourceType: "oauth_signing_key",
        });
        return problem(500, "signing_key_rotation_failed", "Signing-key rotation failed");
      }
    },
  );
}
