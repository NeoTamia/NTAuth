import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

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
    expect(output).toContain("@neotamia/permissions@0.0.0");
    expect(output).toContain("@neotamia/elysia-auth@0.0.0");
    expect(output).toContain("@neotamia/nuxt-auth@0.0.0");
  }, 20_000);

  test("pins a provenance-enabled tag-only npm publication workflow", async () => {
    const workflow = await Bun.file(resolve(root, ".github/workflows/npm-release.yaml")).text();

    expect(workflow).toContain(
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
    );
    expect(workflow).toContain(
      "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2.2.0",
    );
    expect(workflow).toContain("actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0");
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
    expect(workflow).not.toMatch(/uses: [^\s]+@(main|master|v\d+)\s*$/m);
  });
});
