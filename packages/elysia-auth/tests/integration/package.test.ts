import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

describe("published Elysia authentication package", () => {
  test("declares public ESM, types, exact peers, and a constrained tarball", async () => {
    const manifest = await Bun.file(resolve(import.meta.dir, "../../package.json")).json();

    expect(manifest.private).not.toBe(true);
    expect(manifest.exports["."]).toEqual({
      default: "./dist/index.js",
      import: "./dist/index.js",
      types: "./dist/index.d.ts",
    });
    expect(manifest.files).toEqual(["dist", "README.md"]);
    expect(Object.keys(manifest.peerDependencies)).toEqual(["elysia"]);
    expect(manifest.peerDependencies.elysia).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    expect(manifest.dependencies.jose).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  });

  test("bundles as an ESM Bun resource-server package", async () => {
    const result = await Bun.build({
      entrypoints: [resolve(import.meta.dir, "../../src/index.ts")],
      external: ["elysia"],
      target: "bun",
    });

    expect(result.success).toBe(true);
    expect(result.logs).toEqual([]);
    expect(result.outputs).toHaveLength(1);
  });
});
