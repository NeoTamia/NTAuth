import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

describe("published Elysia authentication package", () => {
  test("declares public ESM, types, exact peers, and a constrained tarball", async () => {
    const manifest = await Bun.file(resolve(import.meta.dir, "../package.json")).json();

    expect(manifest.private).not.toBe(true);
    expect(manifest.exports["."]).toEqual({
      default: "./dist/index.js",
      import: "./dist/index.js",
      types: "./dist/index.d.ts",
    });
    expect(manifest.files).toEqual(["dist", "README.md"]);
    expect(manifest.peerDependencies).toEqual({ elysia: "1.4.29" });
    expect(manifest.dependencies.jose).toBe("6.2.8");
  });

  test("bundles as an ESM Bun resource-server package", async () => {
    const result = await Bun.build({
      entrypoints: [resolve(import.meta.dir, "index.ts")],
      external: ["elysia"],
      target: "bun",
    });

    expect(result.success).toBe(true);
    expect(result.logs).toEqual([]);
    expect(result.outputs).toHaveLength(1);
  });
});
