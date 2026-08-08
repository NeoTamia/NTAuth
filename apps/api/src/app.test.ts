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
      corsOrigins: ["http://localhost:3000"],
    });

    const authResponse = await app.handle(
      new Request("http://localhost/api/auth/get-session", {
        headers: { origin: "http://localhost:3000" },
      }),
    );
    expect(authResponse.status).toBe(200);
    expect(await authResponse.json()).toEqual({ path: "/api/auth/get-session" });
    expect(authResponse.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");

    const healthResponse = await app.handle(new Request("http://localhost/health"));
    expect(healthResponse.status).toBe(200);
    expect(await healthResponse.json()).toEqual({ status: "ok" });
  });
});

describe("browser API boundary", () => {
  it("permits the explicit headers used by authenticated MFA requests", async () => {
    const response = await createApp({ corsOrigins: ["http://localhost:3000"] }).handle(
      new Request("http://localhost/api/v1/organizations", {
        headers: {
          "access-control-request-headers": "content-type,x-ntauth-totp,x-request-id",
          "access-control-request-method": "GET",
          origin: "http://localhost:3000",
        },
        method: "OPTIONS",
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "authorization, content-type, if-none-match, x-ntauth-totp, x-request-id",
    );
    expect(response.headers.get("access-control-expose-headers")).toBe(
      "content-disposition, etag, location, www-authenticate, x-ntauth-export-truncated",
    );
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });
});
