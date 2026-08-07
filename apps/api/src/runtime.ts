import { createDatabase } from "@neotamia/db";
import { createClient } from "redis";

import type { ApiEnvironment } from "@neotamia/config";
import type { ReadinessChecks } from "./app";
import { createAuth } from "./auth/auth";
import { createInvitationRoutes } from "./invitations";
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
    database: database.db,
    secret: environment.BETTER_AUTH_SECRET,
    trustedOrigins: environment.CORS_ORIGINS,
  });
  const invitationRoutes = createInvitationRoutes({
    acceptInvitationURL: `${environment.CORS_ORIGINS[0]}/auth/accept-invitation`,
    auth,
    database,
  });
  const userRoutes = createUserRoutes({ auth, database });

  const connectRedis = async () => {
    if (redis.isOpen) return;
    redisConnection ??= redis.connect().then(() => undefined);

    try {
      await redisConnection;
    } finally {
      redisConnection = undefined;
    }
  };

  const readiness: ReadinessChecks = {
    postgres: () => database.ping(),
    redis: async () => {
      await connectRedis();
      await redis.ping();
    },
  };

  return {
    auth,
    invitationRoutes,
    readiness,
    userRoutes,
    async close() {
      const closures: Promise<unknown>[] = [database.close()];

      if (redis.isOpen) closures.push(redis.quit());
      await Promise.allSettled(closures);
    },
  };
}
