import { createApp } from "./app";

const port = Number.parseInt(process.env.API_PORT ?? "3001", 10);
const hostname = process.env.API_HOST ?? "0.0.0.0";
const app = createApp().listen({ hostname, port });

console.log(`NTAuth API listening on http://${app.server?.hostname}:${app.server?.port}`);
