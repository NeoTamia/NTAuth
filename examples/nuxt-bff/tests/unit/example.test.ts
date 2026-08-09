import { describe, expect, test } from "bun:test";

describe("Nuxt BFF example", () => {
  test("ships the plugin, middleware, and token-free server boundary", async () => {
    const paths = [
      "../../app/plugins/ntauth.ts",
      "../../app/middleware/auth.ts",
      "../../server/api/ntauth/session.get.ts",
      "../../server/api/ntauth/logout.post.ts",
    ];
    const sources = await Promise.all(
      paths.map((path) => Bun.file(new URL(path, import.meta.url)).text()),
    );

    expect(sources.every(Boolean)).toBe(true);
    expect(sources.join("\n")).not.toMatch(/access_token|refresh_token/i);
  });
});
