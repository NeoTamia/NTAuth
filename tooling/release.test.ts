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

    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain('NPM_CONFIG_PROVENANCE: "true"');
    expect(workflow).toContain("bun run release:verify --publish");
    expect(workflow).toContain("bun run release");
    expect(workflow).toContain("github.event_name == 'push'");
    expect(workflow).not.toContain("pull_request:");
  });
});
