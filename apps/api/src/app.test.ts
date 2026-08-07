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
