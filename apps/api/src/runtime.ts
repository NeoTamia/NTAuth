import { createDatabase } from "@neotamia/db";
import { createClient } from "redis";

import type { ApiEnvironment } from "@neotamia/config";
import type { ReadinessChecks } from "./app";
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
import { createPasswordRoutes } from "./passwords";
import { createSigningKeyRoutes } from "./signing-keys";
import { createServiceGrantRoutes } from "./service-grants";
import { createUserRoutes } from "./users";

export function createRuntime(environment: ApiEnvironment) {
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
  redis.on("error", () => undefined);

  const auth = createAuth({
    baseURL: environment.AUTH_BASE_URL,
    connection: database,
    database: database.db,
    secret: environment.BETTER_AUTH_SECRET,
    trustedOrigins: environment.CORS_ORIGINS,
  });
  const policyCache = createIamPermissionCache({ client: redis, connect: connectRedis, database });
  const authHandler = createAuditedAuthHandler(auth, database);
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
    discoveryRoutes,
    effectivePolicyRoutes,
    emailVerificationRoutes,
    invitationRoutes,
    iamAttachmentRoutes,
    iamCatalogRoutes,
    iamPolicyRoutes,
    mfaRoutes,
    passwordRoutes,
    readiness,
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
