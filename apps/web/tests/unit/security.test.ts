import { describe, expect, test } from "bun:test";

const configuration = Bun.file(new URL("../../nuxt.config.ts", import.meta.url));
const cspPlugin = Bun.file(
  new URL("../../server/plugins/content-security-policy.ts", import.meta.url),
);

describe("browser security boundary", () => {
  test("ships an explicit CSP and defensive response headers", async () => {
    const configurationSource = await configuration.text();
    const source = await cspPlugin.text();

    expect(source).toContain("default-src 'self'");
    expect(source).toContain("frame-ancestors 'none'");
    expect(source).toContain("object-src 'none'");
    expect(source).toContain("script-src 'self'");
    expect(source).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(source).not.toContain("unsafe-eval");
    expect(source).toContain("'nonce-${nonce}'");
    expect(source).toContain('nonce="${nonce}"');
    expect(configurationSource).not.toContain('"Content-Security-Policy"');
    expect(configurationSource).toContain('"X-Content-Type-Options": "nosniff"');
    expect(configurationSource).toContain('"Permissions-Policy"');
  });
});
