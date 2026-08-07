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
    expect(await response.json()).toEqual({ status: "ready" });
  });
});
