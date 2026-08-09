import { createDatabase } from "@neotamia/db";
import { createStructuredLogger } from "@neotamia/observability";
import { createClient } from "redis";

import type { ApiEnvironment } from "@neotamia/config";
import type { ReadinessChecks } from "./app";
import { createAuditEventRoutes } from "./audit-events";
import { createAuth } from "./auth/auth";
import { createAuditedAuthHandler } from "./auth/audited-handler";
import { createDiscoveryRoutes } from "./auth/discovery";
import { createEffectivePolicyRoutes } from "./effective-policies";
import { createEmailVerificationRoutes } from "./email-verification";
import { createInvitationRoutes } from "./invitations";
import { createIamAttachmentRoutes } from "./iam-attachments";
import { createIamCatalogRoutes } from "./iam-catalog";
import { createIamPermissionCache } from "./iam-cache";
import { createIamPolicyRoutes } from "./iam-policies";
import { createMfaRoutes } from "./mfa";
import { createOrganizationRoutes } from "./organizations";
import { createPasswordRoutes } from "./passwords";
import { createRedisRateLimitStore, createRequestRateLimiter } from "./rate-limit";
import { createApiObservability } from "./observability";
import { createSigningKeyRoutes } from "./signing-keys";
import { createServiceGrantRoutes } from "./service-grants";
import { createUserRoutes } from "./users";

export function createRuntime(environment: ApiEnvironment) {
  const logger = createStructuredLogger("api");
  const observability = createApiObservability({ logger });
  const database = createDatabase(environment.DATABASE_URL, { max: 5 });
  const redis = createClient({
    socket: {
      connectTimeout: 1_000,
      reconnectStrategy: false,
    },
    url: environment.REDIS_URL,
  });
  let redisConnection: Promise<void> | undefined;

  // Availability is exposed through /ready; Redis errors must not crash the process.
  redis.on("error", (error) =>
    logger.log("error", "redis_connection_error", { error_name: error.name }),
  );

  const auth = createAuth({
    baseURL: environment.AUTH_BASE_URL,
    connection: database,
    database: database.db,
    secret: environment.BETTER_AUTH_SECRET,
    secureCookies: environment.NODE_ENV === "production",
    trustedProxies: environment.TRUSTED_PROXY_CIDRS,
    trustedOrigins: environment.CORS_ORIGINS,
  });
  const policyCache = createIamPermissionCache({ client: redis, connect: connectRedis, database });
  const requestLimiter = environment.RATE_LIMIT_ENABLED
    ? createRequestRateLimiter({
        configuration: {
          lockoutSeconds: environment.RATE_LIMIT_LOCKOUT_SECONDS,
          lockoutThreshold: environment.RATE_LIMIT_LOCKOUT_THRESHOLD,
          loginMax: environment.RATE_LIMIT_LOGIN_MAX,
          loginWindowSeconds: environment.RATE_LIMIT_LOGIN_WINDOW_SECONDS,
          oauthMax: environment.RATE_LIMIT_OAUTH_MAX,
          oauthWindowSeconds: environment.RATE_LIMIT_OAUTH_WINDOW_SECONDS,
          recoveryMax: environment.RATE_LIMIT_RECOVERY_MAX,
          recoveryWindowSeconds: environment.RATE_LIMIT_RECOVERY_WINDOW_SECONDS,
        },
        keySecret: environment.BETTER_AUTH_SECRET,
        store: createRedisRateLimitStore({ client: redis, connect: connectRedis }),
        trustProxyHeaders: environment.TRUSTED_PROXY_CIDRS.length > 0,
      })
    : undefined;
  const authHandler = createAuditedAuthHandler(auth, database);
  const auditEventRoutes = createAuditEventRoutes({
    applicationSecret: environment.BETTER_AUTH_SECRET,
    auth,
    database,
  });
  const discoveryRoutes = createDiscoveryRoutes(auth);
  const invitationRoutes = createInvitationRoutes({
    acceptInvitationURL: `${environment.CORS_ORIGINS[0]}/auth/accept-invitation`,
    applicationSecret: environment.BETTER_AUTH_SECRET,
    auth,
    database,
  });
  const iamCatalogRoutes = createIamCatalogRoutes({
    applicationSecret: environment.BETTER_AUTH_SECRET,
    auth,
    database,
  });
  const iamAttachmentRoutes = createIamAttachmentRoutes({
    applicationSecret: environment.BETTER_AUTH_SECRET,
    auth,
    database,
    policyCache,
  });
  const iamPolicyRoutes = createIamPolicyRoutes({
    applicationSecret: environment.BETTER_AUTH_SECRET,
    auth,
    database,
    policyCache,
  });
  const emailVerificationRoutes = createEmailVerificationRoutes({
    database,
    verificationURL: `${environment.CORS_ORIGINS[0]}/auth/verify-email`,
  });
  const effectivePolicyRoutes = createEffectivePolicyRoutes({
    applicationSecret: environment.BETTER_AUTH_SECRET,
    auth,
    database,
    policyCache,
  });
  const userRoutes = createUserRoutes({
    applicationSecret: environment.BETTER_AUTH_SECRET,
    auth,
    database,
  });
  const mfaRoutes = createMfaRoutes({
    applicationSecret: environment.BETTER_AUTH_SECRET,
    auth,
    database,
  });
  const passwordRoutes = createPasswordRoutes({
    auth,
    database,
    resetPasswordURL: `${environment.CORS_ORIGINS[0]}/auth/reset-password`,
  });
  const organizationRoutes = createOrganizationRoutes({
    applicationSecret: environment.BETTER_AUTH_SECRET,
    auth,
    database,
  });
  const signingKeyRoutes = createSigningKeyRoutes({
    applicationSecret: environment.BETTER_AUTH_SECRET,
    auth,
    database,
  });
  const serviceGrantRoutes = createServiceGrantRoutes({
    applicationSecret: environment.BETTER_AUTH_SECRET,
    auth,
    database,
    policyCache,
  });

  async function connectRedis() {
    if (redis.isOpen) return;
    redisConnection ??= redis.connect().then(() => undefined);

    try {
      await redisConnection;
    } finally {
      redisConnection = undefined;
    }
  }

  const readiness: ReadinessChecks = {
    postgres: () => database.ping(),
    redis: async () => {
      await connectRedis();
      await redis.ping();
    },
  };

  return {
    auth,
    authHandler,
    auditEventRoutes,
    discoveryRoutes,
    effectivePolicyRoutes,
    emailVerificationRoutes,
    invitationRoutes,
    iamAttachmentRoutes,
    iamCatalogRoutes,
    iamPolicyRoutes,
    mfaRoutes,
    organizationRoutes,
    observability,
    passwordRoutes,
    readiness,
    requestLimiter,
    signingKeyRoutes,
    serviceGrantRoutes,
    userRoutes,
    async close() {
      const closures: Promise<unknown>[] = [database.close()];

      if (redis.isOpen) closures.push(redis.quit());
      await Promise.allSettled(closures);
    },
  };
}
