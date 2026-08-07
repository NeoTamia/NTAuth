import { describe, expect, it } from "bun:test";
import { createApp } from "./app";

describe("health endpoints", () => {
  it("reports the process as healthy", async () => {
    const response = await createApp().handle(new Request("http://localhost/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("reports the process as ready", async () => {
    const response = await createApp().handle(new Request("http://localhost/ready"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      checks: { postgres: "available", redis: "available" },
      status: "ready",
    });
  });

  it("reports every partial readiness failure without leaking its cause", async () => {
    const secretError = "postgres://user:secret@database/ntauth";
    const response = await createApp({
      readiness: {
        postgres: async () => {
          throw new Error(secretError);
        },
        redis: async () => undefined,
      },
    }).handle(new Request("http://localhost/ready"));

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({
      checks: { postgres: "unavailable", redis: "available" },
      status: "not_ready",
    });
    expect(body).not.toContain(secretError);
  });
});

describe("auth handler", () => {
  it("mounts Better Auth without shadowing service endpoints", async () => {
    const app = createApp({
      authHandler: (request) => Response.json({ path: new URL(request.url).pathname }),
    });

    const authResponse = await app.handle(new Request("http://localhost/api/auth/get-session"));
    expect(authResponse.status).toBe(200);
    expect(await authResponse.json()).toEqual({ path: "/api/auth/get-session" });

    const healthResponse = await app.handle(new Request("http://localhost/health"));
    expect(healthResponse.status).toBe(200);
    expect(await healthResponse.json()).toEqual({ status: "ok" });
  });
});
