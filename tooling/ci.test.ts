import { describe, expect, test } from "bun:test";

const workflowFile = Bun.file(new URL("../.github/workflows/ci.yaml", import.meta.url));

describe("GitHub Actions CI", () => {
  test("pins actions, Bun, and service images exactly", async () => {
    const workflow = await workflowFile.text();

    expect(workflow).toContain(
      "actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd # v5.0.1",
    );
    expect(workflow).toContain(
      "oven-sh/setup-bun@735343b667d3e6f658f44d0eca948eb6282f2b76 # v2.0.2",
    );
    expect(workflow).toContain("actions/cache@cdf6c1fa76f9f475f3d7449005a359c84ca0f306 # v5.0.3");
    expect(workflow).toContain("bun-version: 1.3.14");
    expect(workflow).toContain("image: postgres:18.4-trixie");
    expect(workflow).toContain("image: redis:8.8.1-alpine3.23");
    expect(workflow).not.toMatch(/uses: [^\s]+@(main|master|v\d+)\s*$/m);
  });

  test("runs the frozen validation pipeline with integration services", async () => {
    const workflow = await workflowFile.text();

    expect(workflow).toContain("run: bun install --frozen-lockfile");
    expect(workflow).toContain("run: bun run check");
    expect(workflow).toContain("TEST_DATABASE_URL:");
    expect(workflow).toContain("pg_isready -U ntauth -d ntauth");
    expect(workflow).toContain("redis-cli ping");
  });

  test("limits interrupted or superseded runs and uses a lockfile-only cache key", async () => {
    const workflow = await workflowFile.text();

    expect(workflow).toContain("cancel-in-progress: true");
    expect(workflow).toContain("timeout-minutes: 20");
    expect(workflow).toContain("path: ~/.bun/install/cache");
    expect(workflow).toContain("hashFiles('bun.lock')");
    expect(workflow).not.toContain("node_modules");
    expect(workflow).not.toContain("restore-keys:");
  });
});
