import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

async function run(args: string[]) {
  const child = Bun.spawn(args, { cwd: root, stderr: "pipe", stdout: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stderr, stdout };
}

describe("GitHub Packages mirror", () => {
  test("prepares one checksummed tarball per public package and reuses it for both registries", async () => {
    const preparation = await run(["bun", "tooling/prepare-release-artifacts.ts"]);
    expect(preparation.exitCode, preparation.stderr).toBe(0);
    const manifest = await Bun.file(resolve(root, "release-artifacts/manifest.json")).json();
    expect(manifest.artifacts).toHaveLength(3);
    for (const artifact of manifest.artifacts) {
      expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(artifact.size).toBeGreaterThan(0);
    }

    const publication = await run(["bun", "tooling/publish-release-artifacts.ts", "--dry-run"]);
    expect(publication.exitCode, publication.stderr).toBe(0);
    expect(publication.stdout).toContain("shared npm/GitHub tarballs without publishing");
  }, 20_000);

  test("keeps registry permissions minimal and detects partial publication", async () => {
    const [workflow, publisher] = await Promise.all([
      Bun.file(resolve(root, ".github/workflows/npm-release.yaml")).text(),
      Bun.file(resolve(root, "tooling/publish-release-artifacts.ts")).text(),
    ]);
    expect(workflow).toContain("packages: write");
    expect(workflow).toContain("bun run release:publish");
    expect(publisher).toContain("Partial publication detected");
    expect(publisher).toContain("npm.pkg.github.com");
    expect(publisher).toContain("registry.npmjs.org");
  });
});
