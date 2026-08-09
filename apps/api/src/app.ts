import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";

import type { createAuditEventRoutes } from "./audit-events";
import type { createInvitationRoutes } from "./invitations";
import type { createEffectivePolicyRoutes } from "./effective-policies";
import type { createIamCatalogRoutes } from "./iam-catalog";
import type { createIamAttachmentRoutes } from "./iam-attachments";
import type { createIamPolicyRoutes } from "./iam-policies";
import type { createDiscoveryRoutes } from "./auth/discovery";
import type { createEmailVerificationRoutes } from "./email-verification";
import type { createMfaRoutes } from "./mfa";
import type { createOrganizationRoutes } from "./organizations";
import type { createPasswordRoutes } from "./passwords";
import type { createSigningKeyRoutes } from "./signing-keys";
import type { createServiceGrantRoutes } from "./service-grants";
import type { createUserRoutes } from "./users";
import type { RequestRateLimiter } from "./rate-limit";

export type ReadinessChecks = {
  postgres: () => Promise<void>;
  redis: () => Promise<void>;
};

type AuthHandler = (request: Request) => Promise<Response> | Response;

const available = async () => undefined;
const apiSecurityHeaders = {
  "content-security-policy":
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), geolocation=(), microphone=()",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

export const createApp = (
  options: {
    auditEventRoutes?: ReturnType<typeof createAuditEventRoutes>;
    authHandler?: AuthHandler;
    corsOrigins?: string[];
    discoveryRoutes?: ReturnType<typeof createDiscoveryRoutes>;
    emailVerificationRoutes?: ReturnType<typeof createEmailVerificationRoutes>;
    effectivePolicyRoutes?: ReturnType<typeof createEffectivePolicyRoutes>;
    invitationRoutes?: ReturnType<typeof createInvitationRoutes>;
    iamAttachmentRoutes?: ReturnType<typeof createIamAttachmentRoutes>;
    iamCatalogRoutes?: ReturnType<typeof createIamCatalogRoutes>;
    iamPolicyRoutes?: ReturnType<typeof createIamPolicyRoutes>;
    mfaRoutes?: ReturnType<typeof createMfaRoutes>;
    organizationRoutes?: ReturnType<typeof createOrganizationRoutes>;
    passwordRoutes?: ReturnType<typeof createPasswordRoutes>;
    requestLimiter?: RequestRateLimiter;
    readiness?: ReadinessChecks;
    signingKeyRoutes?: ReturnType<typeof createSigningKeyRoutes>;
    serviceGrantRoutes?: ReturnType<typeof createServiceGrantRoutes>;
    userRoutes?: ReturnType<typeof createUserRoutes>;
  } = {},
) => {
  const routes = new Elysia();

  if (options.auditEventRoutes) routes.use(options.auditEventRoutes);
  if (options.authHandler) routes.mount(options.authHandler);
  if (options.discoveryRoutes) routes.use(options.discoveryRoutes);
  if (options.emailVerificationRoutes) routes.use(options.emailVerificationRoutes);
  if (options.effectivePolicyRoutes) routes.use(options.effectivePolicyRoutes);
  if (options.invitationRoutes) routes.use(options.invitationRoutes);
  if (options.iamAttachmentRoutes) routes.use(options.iamAttachmentRoutes);
  if (options.iamCatalogRoutes) routes.use(options.iamCatalogRoutes);
  if (options.iamPolicyRoutes) routes.use(options.iamPolicyRoutes);
  if (options.mfaRoutes) routes.use(options.mfaRoutes);
  if (options.organizationRoutes) routes.use(options.organizationRoutes);
  if (options.passwordRoutes) routes.use(options.passwordRoutes);
  if (options.signingKeyRoutes) routes.use(options.signingKeyRoutes);
  if (options.serviceGrantRoutes) routes.use(options.serviceGrantRoutes);
  if (options.userRoutes) routes.use(options.userRoutes);

  return new Elysia()
    .onRequest(({ request }) => options.requestLimiter?.check(request))
    .onAfterHandle(({ request, response, set }) =>
      options.requestLimiter?.observe(
        request,
        response instanceof Response
          ? response.status
          : typeof set.status === "number"
            ? set.status
            : 200,
      ),
    )
    .onAfterHandle(({ set }) => {
      for (const [name, value] of Object.entries(apiSecurityHeaders)) set.headers[name] = value;
    })
    .use(
      cors({
        allowedHeaders: [
          "authorization",
          "content-type",
          "if-none-match",
          "x-ntauth-totp",
          "x-request-id",
        ],
        exposeHeaders: [
          "content-disposition",
          "etag",
          "location",
          "www-authenticate",
          "x-ntauth-export-truncated",
        ],
        origin: options.corsOrigins,
      }),
    )
    .get("/health", () => ({ status: "ok" }))
    .get("/ready", async ({ set }) => {
      const checks = options.readiness ?? { postgres: available, redis: available };
      const [postgres, redis] = await Promise.allSettled([checks.postgres(), checks.redis()]);
      const status = {
        postgres: postgres.status === "fulfilled" ? "available" : "unavailable",
        redis: redis.status === "fulfilled" ? "available" : "unavailable",
      } as const;

      if (postgres.status === "rejected" || redis.status === "rejected") {
        set.status = 503;
        return { checks: status, status: "not_ready" as const };
      }

      return { checks: status, status: "ready" as const };
    })
    .mount(routes.handle);
};
