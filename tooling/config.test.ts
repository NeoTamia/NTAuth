import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

interface OxlintConfig {
  extends?: string[];
}

interface TypeScriptConfig {
  compilerOptions?: {
    paths?: Record<string, string[]>;
    [key: string]: unknown;
  };
  extends?: string;
}

const rootDirectory = resolve(import.meta.dir, "..");

const readJson = async <Value>(path: string): Promise<Value> =>
  Bun.file(resolve(rootDirectory, path)).json();

const scan = async (pattern: string) => {
  const glob = new Bun.Glob(pattern);
  return Array.fromAsync(glob.scan({ cwd: rootDirectory, onlyFiles: true }));
};

describe("shared configuration", () => {
  it("keeps the root Oxlint configuration on the shared preset", async () => {
    const config = await readJson<OxlintConfig>(".oxlintrc.json");

    expect(config.extends).toEqual(["./packages/config/oxlint/base.json"]);
  });

  it("keeps TypeScript strict in the shared base", async () => {
    const config = await readJson<TypeScriptConfig>("packages/config/tsconfig/base.json");

    expect(config.compilerOptions).toMatchObject({
      noUncheckedIndexedAccess: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      strict: true,
    });
  });

  it("makes every explicit workspace tsconfig inherit the shared base", async () => {
    const paths = (
      await Promise.all([scan("apps/*/tsconfig.json"), scan("packages/*/tsconfig.json")])
    )
      .flat()
      .filter((path) => path !== "packages/config/tsconfig.json");
    const configs = await Promise.all(paths.map(readJson<TypeScriptConfig>));

    for (const config of configs) {
      expect(config.extends).toMatch(/config\/tsconfig\/base\.json$/);
    }
  });

  it("provides a source-root alias to workspace tests", async () => {
    const sourceConfigPaths = [
      "apps/api/tsconfig.json",
      "apps/worker/tsconfig.json",
      "examples/elysia-resource-server/tsconfig.json",
      "packages/config/tsconfig.json",
      "packages/db/tsconfig.json",
      "packages/elysia-auth/tsconfig.json",
      "packages/nuxt-auth/tsconfig.json",
      "packages/observability/tsconfig.json",
      "packages/permissions/tsconfig.json",
      "packages/test-utils/tsconfig.json",
    ];
    const sourceConfigs = await Promise.all(sourceConfigPaths.map(readJson<TypeScriptConfig>));

    for (const config of sourceConfigs) {
      expect(config.compilerOptions?.paths?.["@/*"]).toEqual(["./src/*"]);
    }

    const nuxtConfigs = await Promise.all(
      ["apps/web/tests/tsconfig.json", "examples/nuxt-bff/tests/tsconfig.json"].map(
        readJson<TypeScriptConfig>,
      ),
    );
    for (const config of nuxtConfigs) {
      expect(config.extends).toBe("../.nuxt/tsconfig.json");
    }
  });

  it("does not contain ESLint configuration", async () => {
    const patterns = [
      ".eslintrc*",
      "eslint.config.*",
      "apps/*/.eslintrc*",
      "apps/*/eslint.config.*",
      "packages/*/.eslintrc*",
      "packages/*/eslint.config.*",
    ];
    const paths = await Promise.all(patterns.map(scan));

    expect(paths.flat()).toEqual([]);
  });
});
