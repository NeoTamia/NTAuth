import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const packageDirectory = resolve(import.meta.dir, "../..");

describe("published permissions package", () => {
  test("declares a public ESM and types-only distribution contract", async () => {
    const manifest = await Bun.file(resolve(packageDirectory, "package.json")).json();

    expect(manifest.private).not.toBe(true);
    expect(manifest.sideEffects).toBe(false);
    expect(manifest.exports["."]).toEqual({
      default: "./dist/index.js",
      import: "./dist/index.js",
      types: "./dist/index.d.ts",
    });
    expect(manifest.files).toEqual(["dist", "README.md"]);
    expect(manifest.publishConfig).toEqual({ access: "public", provenance: true });
  });

  test("bundles without server globals for Bun, Node, and Nuxt consumers", async () => {
    const entrypoint = resolve(packageDirectory, "src/index.ts");
    const results = await Promise.all(
      (["bun", "node", "browser"] as const).map((target) =>
        Bun.build({ entrypoints: [entrypoint], target }),
      ),
    );

    for (const result of results) {
      expect(result.success).toBe(true);
      expect(result.logs).toEqual([]);
      expect(result.outputs).toHaveLength(1);
    }
  });
});
