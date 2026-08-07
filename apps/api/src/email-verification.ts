import { Elysia } from "elysia";

import {
  completeEmailVerification,
  InvalidEmailVerificationError,
  requestEmailVerification,
  type DatabaseConnection,
} from "@neotamia/db";

function problem() {
  return new Response(
    JSON.stringify({
      code: "invalid_email_verification",
      status: 400,
      title: "Email verification is invalid or unavailable",
      type: "urn:ntauth:error:invalid_email_verification",
    }),
    { headers: { "content-type": "application/problem+json" }, status: 400 },
  );
}

function bodyOf(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

export function createEmailVerificationRoutes(options: {
  database: DatabaseConnection;
  verificationURL: string;
}) {
  return new Elysia({ prefix: "/api/v1/email-verification" })
    .post("/request", async ({ body }) => {
      const input = bodyOf(body);
      if (typeof input?.email !== "string") return problem();
      await requestEmailVerification(options.database, {
        email: input.email,
        verificationBaseURL: options.verificationURL,
      });
      return Response.json({ status: "accepted" }, { status: 202 });
    })
    .post("/verify", async ({ body }) => {
      const input = bodyOf(body);
      if (typeof input?.token !== "string") return problem();
      try {
        await completeEmailVerification(options.database, input.token);
        return Response.json({ status: "verified" });
      } catch (error) {
        if (error instanceof InvalidEmailVerificationError) return problem();
        return problem();
      }
    });
}
