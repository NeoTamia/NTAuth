import { describe, expect, test } from "bun:test";

const composeFile = Bun.file(new URL("../compose.yaml", import.meta.url));
const dockerfile = Bun.file(new URL("../Dockerfile", import.meta.url));

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

    expect(compose.match(/healthcheck:/g)).toHaveLength(6);
    expect(compose).toContain("postgres-data:/var/lib/postgresql");
    expect(compose).toContain("redis-data:/data");
    expect(compose).toContain("mailpit-data:/data");
    expect(compose).toContain("${POSTGRES_HOST_PORT:-5432}:5432");
  });

  test("builds every application from exact slim runtimes", async () => {
    const source = await dockerfile.text();

    expect(source.match(/FROM oven\/bun:1\.3\.14-slim(?:\s|$)/gm)).toHaveLength(5);
    expect(source).toContain("FROM node:24.6.0-bookworm-slim AS web-build");
    expect(source).not.toMatch(/^FROM .+alpine/im);
    expect(source).toContain("bun install --frozen-lockfile");
    expect(source).toContain("bun --filter @neotamia/permissions build");
    expect(source).toContain("AS api");
    expect(source).toContain("AS worker");
    expect(source).toContain("AS web");
  });

  test("orders migrations and applications by health", async () => {
    const compose = await composeFile.text();

    expect(compose).toContain("condition: service_completed_successfully");
    expect(compose).toContain("target: migrate");
    expect(compose).toContain("target: api");
    expect(compose).toContain("target: worker");
    expect(compose).toContain("target: web");
  });
});
