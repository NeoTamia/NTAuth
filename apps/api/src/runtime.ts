import { createDatabase } from "@neotamia/db";
import { createClient } from "redis";

import type { ApiEnvironment } from "@neotamia/config";
import type { ReadinessChecks } from "./app";

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
    readiness,
    async close() {
      const closures: Promise<unknown>[] = [database.close()];

      if (redis.isOpen) closures.push(redis.quit());
      await Promise.allSettled(closures);
    },
  };
}
