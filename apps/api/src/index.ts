import { parseApiEnvironment } from "@neotamia/config";

import { createApp } from "./app";

const environment = parseApiEnvironment();
const app = createApp().listen({
  hostname: environment.API_HOST,
  port: environment.API_PORT,
});

console.log(`NTAuth API listening on http://${app.server?.hostname}:${app.server?.port}`);
