import { materializeSecretFiles, parseApiEnvironment } from "@neotamia/config";

import { createApp } from "./app";
import { createRuntime } from "./runtime";

const environment = parseApiEnvironment(
  await materializeSecretFiles(process.env, ["BETTER_AUTH_SECRET", "DATABASE_URL", "REDIS_URL"]),
);
const runtime = createRuntime(environment);
const app = createApp({
  auditEventRoutes: runtime.auditEventRoutes,
  authHandler: runtime.authHandler,
  corsOrigins: environment.CORS_ORIGINS,
  discoveryRoutes: runtime.discoveryRoutes,
  effectivePolicyRoutes: runtime.effectivePolicyRoutes,
  emailVerificationRoutes: runtime.emailVerificationRoutes,
  invitationRoutes: runtime.invitationRoutes,
  iamAttachmentRoutes: runtime.iamAttachmentRoutes,
  iamCatalogRoutes: runtime.iamCatalogRoutes,
  iamPolicyRoutes: runtime.iamPolicyRoutes,
  mfaRoutes: runtime.mfaRoutes,
  organizationRoutes: runtime.organizationRoutes,
  observability: runtime.observability,
  passwordRoutes: runtime.passwordRoutes,
  readiness: runtime.readiness,
  requestLimiter: runtime.requestLimiter,
  serviceGrantRoutes: runtime.serviceGrantRoutes,
  signingKeyRoutes: runtime.signingKeyRoutes,
  userRoutes: runtime.userRoutes,
}).listen({
  hostname: environment.API_HOST,
  port: environment.API_PORT,
});

runtime.observability.event("info", "api_ready", {
  host: app.server?.hostname,
  port: app.server?.port,
});

let stopping = false;
const stop = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  runtime.observability.event("info", "api_stopping", { signal });
  await app.stop();
  await runtime.close();
};

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
