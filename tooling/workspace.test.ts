import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  name: string;
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
];

const isExactExternalVersion = (version: string) =>
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version);

describe("monorepo workspaces", () => {
  it("declares the expected Bun workspace roots and root commands", async () => {
    const root = await readManifest("package.json");

    expect(root.private).toBe(true);
    expect(root.workspaces).toEqual(["apps/*", "examples/*", "packages/*"]);
    expect(root.scripts).toMatchObject({
      build: "turbo run build",
      dev: "turbo run dev",
      lint: "oxlint .",
      typecheck: "turbo run typecheck",
    });
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
