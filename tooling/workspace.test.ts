import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  name: string;
  peerDependencies?: Record<string, string>;
  private?: boolean;
  scripts?: Record<string, string>;
  version: string;
  workspaces?: string[];
}

const rootDirectory = resolve(import.meta.dir, "..");

const readManifest = async (path: string): Promise<PackageManifest> =>
  Bun.file(resolve(rootDirectory, path)).json();

const workspaceManifestPaths = async () => {
  const scan = async (pattern: string) => {
    const glob = new Bun.Glob(pattern);
    return Array.fromAsync(glob.scan({ cwd: rootDirectory, onlyFiles: true }));
  };

  const paths = await Promise.all(
    ["apps/*/package.json", "examples/*/package.json", "packages/*/package.json"].map(scan),
  );

  return paths.flat().toSorted();
};

const dependencyEntries = (manifest: PackageManifest) => [
  ...Object.entries(manifest.dependencies ?? {}),
  ...Object.entries(manifest.devDependencies ?? {}),
  ...Object.entries(manifest.peerDependencies ?? {}),
];

const isExactExternalVersion = (version: string) =>
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version);

describe("monorepo workspaces", () => {
  it("keeps workspace tests outside production sources and grouped by level", async () => {
    const paths = (
      await Promise.all(
        ["apps/**/*.test.ts", "examples/**/*.test.ts", "packages/**/*.test.ts"].map(
          async (pattern) =>
            Array.fromAsync(new Bun.Glob(pattern).scan({ cwd: rootDirectory, onlyFiles: true })),
        ),
      )
    )
      .flat()
      .toSorted();

    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path).toMatch(/^(?:apps|examples|packages)\/[^/]+\/tests\/(?:unit|integration|e2e)\//);
      if (path.endsWith(".integration.test.ts") || path.endsWith("/package.test.ts")) {
        expect(path).toContain("/tests/integration/");
      }
      if (path.endsWith(".e2e.test.ts")) {
        expect(path).toContain("/tests/e2e/");
      }
    }
  });

  it("builds workspace dependencies before consuming their generated types", async () => {
    const configuration = await Bun.file(resolve(rootDirectory, "turbo.json")).json();

    expect(configuration.tasks.typecheck.dependsOn).toContain("^build");
    expect(configuration.tasks.typecheck.dependsOn).toContain("^typecheck");
    expect(configuration.tasks.test.cache).toBe(false);
  });

  it("declares the expected Bun workspace roots and root commands", async () => {
    const root = await readManifest("package.json");

    expect(root.private).toBe(true);
    expect(root.workspaces).toEqual(["apps/*", "examples/*", "packages/*"]);
    expect(root.scripts).toMatchObject({
      build: "turbo run build",
      lint: "oxlint .",
      typecheck: "turbo run typecheck",
    });
    expect(root.scripts.dev).toContain("--env-file=.env");
    expect(root.scripts.dev).toContain("turbo run dev");
    expect(root.scripts.dev).toContain("--filter='./apps/*'");
    expect(root.scripts.dev).toContain("--env-mode=loose");
  });

  it("has unique names and valid versions for every workspace", async () => {
    const paths = await workspaceManifestPaths();
    const manifests = await Promise.all(paths.map(readManifest));
    const names = manifests.map((manifest) => manifest.name);

    expect(paths.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);

    for (const manifest of manifests) {
      expect(manifest.name).toMatch(/^@neotamia\/[a-z0-9-]+$/);
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
      if (manifest.scripts?.test) {
        expect(manifest.scripts.test).toBe("bun test tests");
      }
    }
  });

  it("pins every external dependency to an exact version", async () => {
    const paths = ["package.json", ...(await workspaceManifestPaths())];
    const manifests = await Promise.all(paths.map(readManifest));

    for (const [index, manifest] of manifests.entries()) {
      const path = paths[index];
      for (const [name, version] of dependencyEntries(manifest)) {
        if (version.startsWith("workspace:")) continue;
        expect(isExactExternalVersion(version), `${path}: ${name}@${version}`).toBe(true);
      }
    }
  });
});
