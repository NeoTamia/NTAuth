import { describe, expect, test } from "bun:test";

const appRoot = new URL("../../app/", import.meta.url).pathname;

describe("native form fallbacks", () => {
  test("never serializes a Vue-handled form into a GET URL", async () => {
    const vueFiles = Array.from(new Bun.Glob("**/*.vue").scanSync({ cwd: appRoot }));
    const components = await Promise.all(
      vueFiles.map(async (file) => ({ file, source: await Bun.file(`${appRoot}${file}`).text() })),
    );

    for (const { file, source } of components) {
      const forms = source.match(/<form\b[\s\S]*?>/g) ?? [];

      for (const form of forms.filter((tag) => tag.includes("@submit.prevent"))) {
        expect(form, `${file} contains a form whose native fallback defaults to GET`).toContain(
          'method="post"',
        );
      }
    }
  });
});
