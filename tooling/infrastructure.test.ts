import { describe, expect, test } from "bun:test";

const composeFile = Bun.file(new URL("../compose.yaml", import.meta.url));
const dockerfile = Bun.file(new URL("../Dockerfile", import.meta.url));

describe("local infrastructure", () => {
  test("pins every infrastructure image to an immutable digest", async () => {
    const compose = await composeFile.text();
    const images = compose.match(/^\s+image:\s+\S+$/gm) ?? [];

    expect(images).toHaveLength(3);
    expect(compose).toMatch(/image: postgres:[^\s@]+@sha256:[0-9a-f]{64}$/m);
    expect(compose).toMatch(/image: redis:[^\s@]+@sha256:[0-9a-f]{64}$/m);
    expect(compose).toMatch(/image: axllent\/mailpit:[^\s@]+@sha256:[0-9a-f]{64}$/m);
    expect(compose).not.toMatch(/image: .+:(latest|alpine)\s*$/m);
  });

  test("defines persistence and health checks for every service", async () => {
    const compose = await composeFile.text();

    expect(compose.match(/healthcheck:/g)).toHaveLength(6);
    expect(compose).toContain("postgres-data:/var/lib/postgresql");
    expect(compose).toContain("init-test-database.sql:/docker-entrypoint-initdb.d/");
    expect(compose).toContain("redis-data:/data");
    expect(compose).toContain("mailpit-data:/data");
    expect(compose).toContain("${POSTGRES_HOST_PORT:-5432}:5432");
  });

  test("isolates local integration tests from the application database", async () => {
    const compose = await composeFile.text();
    const exampleEnvironment = await Bun.file(new URL("../.env.example", import.meta.url)).text();
    const rootPackage = await Bun.file(new URL("../package.json", import.meta.url)).text();
    const initializer = await Bun.file(
      new URL("../deploy/postgres/init-test-database.sql", import.meta.url),
    ).text();

    expect(exampleEnvironment).toContain(
      "TEST_DATABASE_URL=postgres://ntauth:ntauth@localhost:5432/ntauth_test",
    );
    expect(initializer).toContain("CREATE DATABASE ntauth_test");
    expect(compose).toContain("init-test-database.sql");
    expect(rootPackage).toContain("tooling/assert-test-database.ts");
  });

  test("builds every application from versioned slim runtimes", async () => {
    const source = await dockerfile.text();

    expect(source.match(/FROM oven\/bun:[^\s@]+-slim@sha256:[0-9a-f]{64}(?:\s|$)/gm)).toHaveLength(
      2,
    );
    expect(source.match(/^FROM runtime AS (api|migrate|web|worker)$/gm)).toHaveLength(4);
    expect(source).toMatch(/^FROM node:[^\s@]*slim@sha256:[0-9a-f]{64} AS web-build$/m);
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
