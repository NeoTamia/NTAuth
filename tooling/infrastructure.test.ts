import { describe, expect, test } from "bun:test";

const composeFile = Bun.file(new URL("../compose.yaml", import.meta.url));
const dockerfile = Bun.file(new URL("../Dockerfile", import.meta.url));

describe("local infrastructure", () => {
  test("pins every infrastructure image to a versioned tag", async () => {
    const compose = await composeFile.text();
    const images = compose.match(/^\s+image:\s+\S+$/gm) ?? [];

    expect(images).toHaveLength(3);
    expect(compose).toMatch(/image: postgres:v?\d+(?:\.\d+)+(?:-[\w.-]+)?$/m);
    expect(compose).toMatch(/image: redis:v?\d+(?:\.\d+)+(?:-[\w.-]+)?$/m);
    expect(compose).toMatch(/image: axllent\/mailpit:v?\d+(?:\.\d+)+(?:-[\w.-]+)?$/m);
    expect(compose).not.toMatch(/image: .+:(latest|alpine)\s*$/m);
  });

  test("defines persistence and health checks for every service", async () => {
    const compose = await composeFile.text();

    expect(compose.match(/healthcheck:/g)).toHaveLength(6);
    expect(compose).toContain("postgres-data:/var/lib/postgresql");
    expect(compose).toContain("redis-data:/data");
    expect(compose).toContain("mailpit-data:/data");
    expect(compose).toContain("${POSTGRES_HOST_PORT:-5432}:5432");
  });

  test("builds every application from versioned slim runtimes", async () => {
    const source = await dockerfile.text();

    expect(source.match(/FROM oven\/bun:\d+(?:\.\d+)+-slim(?:\s|$)/gm)).toHaveLength(2);
    expect(source.match(/^FROM runtime AS (api|migrate|web|worker)$/gm)).toHaveLength(4);
    expect(source).toMatch(/^FROM node:\d+(?:\.\d+)+(?:-[\w.-]*slim) AS web-build$/m);
    expect(source).not.toMatch(/^FROM .+alpine/im);
    for (const dependency of ["libcap2", "libssl3t64", "openssl-provider-legacy"]) {
      expect(source).toMatch(new RegExp(`\\b${dependency}=[^\\s\\\\]+`));
    }
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
