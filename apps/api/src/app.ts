import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";

export const createApp = () =>
  new Elysia()
    .use(cors())
    .get("/health", () => ({ status: "ok" }))
    .get("/ready", () => ({ status: "ready" }));
