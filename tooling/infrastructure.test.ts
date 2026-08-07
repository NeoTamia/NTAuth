import { describe, expect, test } from "bun:test";

const composeFile = Bun.file(new URL("../compose.yaml", import.meta.url));

describe("local infrastructure", () => {
  test("pins every infrastructure image to an immutable version tag", async () => {
    const compose = await composeFile.text();

    expect(compose).toContain("postgres:18.4-trixie");
    expect(compose).toContain("redis:8.8.1-alpine3.23");
    expect(compose).toContain("axllent/mailpit:v1.30.0");
    expect(compose).not.toMatch(/image: .+:(latest|18|8|alpine)\s*$/m);
  });

  test("defines persistence and health checks for every service", async () => {
    const compose = await composeFile.text();

    expect(compose.match(/healthcheck:/g)).toHaveLength(3);
    expect(compose).toContain("postgres-data:/var/lib/postgresql");
    expect(compose).toContain("redis-data:/data");
    expect(compose).toContain("mailpit-data:/data");
    expect(compose).toContain("${POSTGRES_HOST_PORT:-5432}:5432");
  });
});
