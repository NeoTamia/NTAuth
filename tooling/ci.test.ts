import { describe, expect, test } from "bun:test";

const workflowFile = Bun.file(new URL("../.github/workflows/ci.yaml", import.meta.url));

describe("GitHub Actions CI", () => {
  test("pins actions, Bun, and service images exactly", async () => {
    const workflow = await workflowFile.text();

    expect(workflow).toContain(
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
    );
    expect(workflow).toContain(
      "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0",
    );
    expect(workflow).toContain("actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0");
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

  test("limits execution paths and reuses safe build caches", async () => {
    const workflow = await workflowFile.text();

    expect(workflow).toContain("cancel-in-progress: true");
    expect(workflow).toContain("timeout-minutes: 20");
    expect(workflow.match(/paths:/g)).toHaveLength(2);
    expect(workflow).toContain('"apps/**"');
    expect(workflow).toContain('"packages/**"');
    expect(workflow).not.toContain('"docs/**"');
    expect(workflow).toContain("~/.bun/install/cache");
    expect(workflow).toContain("hashFiles('bun.lock')");
    expect(workflow).toContain(".turbo");
    expect(workflow).toContain("github.sha");
    expect(workflow).toContain("restore-keys:");
    expect(workflow).not.toContain("node_modules");
  });
});
