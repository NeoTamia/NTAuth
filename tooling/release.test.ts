import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

const expectActionsPinnedToCommits = (workflow: string) => {
  const actionLines = workflow.match(/^\s*uses:\s+.+$/gm) ?? [];

  expect(actionLines.length).toBeGreaterThan(0);
  for (const line of actionLines) {
    expect(line).toMatch(/^\s*uses:\s+[^@\s]+@[0-9a-f]{40}(?:\s+#.*)?$/);
  }
};

describe("npm public release", () => {
  test("verifies package exports and dry-run tarballs without publishing", async () => {
    const process = Bun.spawn(["bun", "tooling/verify-release.ts"], {
      cwd: root,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, output, error] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);

    expect(exitCode, error).toBe(0);
    for (const name of ["permissions", "elysia-auth", "nuxt-auth"]) {
      expect(output).toMatch(new RegExp(`@neotamia/${name}@\\d+\\.\\d+\\.\\d+(?:-[^\\s]+)?`));
    }
  }, 20_000);

  test("pins a provenance-enabled tag-only npm publication workflow", async () => {
    const workflow = await Bun.file(resolve(root, ".github/workflows/npm-release.yaml")).text();

    expectActionsPinnedToCommits(workflow);
    expect(workflow).toContain("~/.bun/install/cache");
    expect(workflow).toContain(".turbo");
    expect(workflow).toContain("github.sha");
    expect(workflow).toContain("restore-keys:");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain('NPM_CONFIG_PROVENANCE: "true"');
    expect(workflow).toContain("bun run release:verify --publish");
    expect(workflow).toContain("bun run release");
    expect(workflow).toContain("github.event_name == 'push'");
    expect(workflow).not.toContain("pull_request:");
  });
});
