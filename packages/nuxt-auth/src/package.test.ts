import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

describe("published Nuxt authentication package", () => {
  test("declares public ESM, types, exact peers, and a constrained tarball", async () => {
    const manifest = await Bun.file(resolve(import.meta.dir, "../package.json")).json();

    expect(manifest.private).not.toBe(true);
    expect(manifest.exports["."]).toEqual({
      default: "./dist/index.js",
      import: "./dist/index.js",
      types: "./dist/index.d.ts",
    });
    expect(manifest.files).toEqual(["dist", "README.md"]);
    expect(manifest.peerDependencies).toEqual({ nuxt: "4.5.2", vue: "3.5.41" });
  });

  test("bundles for Nuxt client and server runtimes without browser globals at import", async () => {
    const entrypoint = resolve(import.meta.dir, "index.ts");
    const results = await Promise.all(
      (["browser", "node", "bun"] as const).map((target) =>
        Bun.build({ entrypoints: [entrypoint], external: ["vue"], target }),
      ),
    );
    for (const result of results) {
      expect(result.success).toBe(true);
      expect(result.logs).toEqual([]);
    }
  });
});
