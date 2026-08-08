import { parseApiEnvironment } from "@neotamia/config";

import { createApp } from "./app";
import { createRuntime } from "./runtime";

const environment = parseApiEnvironment();
const runtime = createRuntime(environment);
const app = createApp({
  authHandler: runtime.authHandler,
  corsOrigins: environment.CORS_ORIGINS,
  discoveryRoutes: runtime.discoveryRoutes,
  emailVerificationRoutes: runtime.emailVerificationRoutes,
  invitationRoutes: runtime.invitationRoutes,
  mfaRoutes: runtime.mfaRoutes,
  passwordRoutes: runtime.passwordRoutes,
  readiness: runtime.readiness,
  serviceGrantRoutes: runtime.serviceGrantRoutes,
  signingKeyRoutes: runtime.signingKeyRoutes,
  userRoutes: runtime.userRoutes,
}).listen({
  hostname: environment.API_HOST,
  port: environment.API_PORT,
});

console.log(`NTAuth API listening on http://${app.server?.hostname}:${app.server?.port}`);

let stopping = false;
const stop = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.log(`NTAuth API received ${signal}; stopping`);
  await app.stop();
  await runtime.close();
};

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
