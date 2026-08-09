import { describe, expect, test } from "bun:test";

const workflowFile = Bun.file(new URL("../.github/workflows/ci.yaml", import.meta.url));
const manifestFile = Bun.file(new URL("../package.json", import.meta.url));

const expectActionsPinnedToCommits = (workflow: string) => {
  const actionLines = workflow.match(/^\s*uses:\s+.+$/gm) ?? [];

  expect(actionLines.length).toBeGreaterThan(0);
  for (const line of actionLines) {
    expect(line).toMatch(/^\s*uses:\s+[^@\s]+@[0-9a-f]{40}(?:\s+#.*)?$/);
  }
};

describe("GitHub Actions CI", () => {
  test("pins actions and service images immutably while sharing the Bun version", async () => {
    const workflow = await workflowFile.text();
    const manifest = (await manifestFile.json()) as {
      engines: { bun: string };
      packageManager: string;
    };

    expectActionsPinnedToCommits(workflow);
    expect(manifest.packageManager).toBe(`bun@${manifest.engines.bun}`);
    expect(workflow).toContain(`bun-version: ${manifest.engines.bun}`);
    expect(workflow).toMatch(/image: postgres:[^\s@]+@sha256:[0-9a-f]{64}$/m);
    expect(workflow).toMatch(/image: redis:[^\s@]+@sha256:[0-9a-f]{64}$/m);
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
