import { describe, expect, test } from "bun:test";

import { createExampleResourceServer } from "./app";

describe("Elysia resource-server example", () => {
  test("starts the protected route and returns the documented bearer error", async () => {
    const app = createExampleResourceServer({
      audience: "urn:neotamia:service:ntscout",
      issuer: "https://auth.example.test",
      service: "ntscout",
    });
    const response = await app.handle(new Request("http://localhost/reports/quarterly"));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Bearer error="authentication_required"');
  });
});
