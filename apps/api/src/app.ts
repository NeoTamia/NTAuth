import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";

import type { createInvitationRoutes } from "./invitations";
import type { createPasswordRoutes } from "./passwords";
import type { createUserRoutes } from "./users";

export type ReadinessChecks = {
  postgres: () => Promise<void>;
  redis: () => Promise<void>;
};

type AuthHandler = (request: Request) => Promise<Response> | Response;

const available = async () => undefined;

export const createApp = (
  options: {
    authHandler?: AuthHandler;
    corsOrigins?: string[];
    invitationRoutes?: ReturnType<typeof createInvitationRoutes>;
    passwordRoutes?: ReturnType<typeof createPasswordRoutes>;
    readiness?: ReadinessChecks;
    userRoutes?: ReturnType<typeof createUserRoutes>;
  } = {},
) => {
  const app = new Elysia().use(cors({ origin: options.corsOrigins }));

  if (options.authHandler) app.mount(options.authHandler);
  if (options.invitationRoutes) app.use(options.invitationRoutes);
  if (options.passwordRoutes) app.use(options.passwordRoutes);
  if (options.userRoutes) app.use(options.userRoutes);

  return app
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
    });
};
