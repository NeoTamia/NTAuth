import { describe, expect, test } from "bun:test";
import { contrastRatio, meetsWcagAa } from "@/utils/accessibility";

const adminPages = [
  "security/mfa.vue",
  "organizations.vue",
  "catalogue.vue",
  "policies.vue",
  "users.vue",
  "service-grants.vue",
  "audit-events.vue",
  "oauth-clients.vue",
];

async function read(relativePath: string) {
  return Bun.file(new URL(`../../${relativePath}`, import.meta.url)).text();
}

describe("accessibility contracts", () => {
  test("keeps the application palette above WCAG AA contrast", () => {
    const pairs = [
      ["#1c5941", "#ffffff"],
      ["#14201b", "#f5f7f3"],
      ["#536158", "#eef1ed"],
      ["#b84b26", "#f5f7f3"],
      ["#9b3b24", "#eef1ed"],
      ["#176b43", "#eef1ed"],
    ] as const;

    for (const [foreground, background] of pairs) {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
      expect(meetsWcagAa(foreground, background)).toBe(true);
    }
  });

  test("exposes visible focus, reduced motion, and hidden assistive text primitives", async () => {
    const css = await read("app/assets/css/main.css");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".sr-only");
    expect(css).toContain("animation-duration: 0.01ms !important");
  });

  test("announces useful loading skeletons without exposing decorative lines", async () => {
    const skeleton = await read("app/components/LoadingSkeleton.vue");
    expect(skeleton).toContain('role="status"');
    expect(skeleton).toContain('aria-live="polite"');
    expect(skeleton).toContain('aria-busy="true"');
    expect(skeleton).toContain('aria-hidden="true"');

    const pages = await Promise.all(adminPages.map((page) => read(`app/pages/admin/${page}`)));
    expect(pages.filter((page) => page.includes("<LoadingSkeleton")).length).toBeGreaterThanOrEqual(
      5,
    );
  });

  test("keeps admin pages keyboard-safe and errors recoverable", async () => {
    const pages = await Promise.all(adminPages.map((page) => read(`app/pages/admin/${page}`)));
    for (const page of pages) {
      expect(page).not.toMatch(/tabindex=["'](?:[1-9]|\+)[^"']*["']/);
    }

    const recoverablePages = ["security/mfa.vue", "catalogue.vue", "policies.vue", "users.vue"];
    const recoverableSources = await Promise.all(
      recoverablePages.map((page) => read(`app/pages/admin/${page}`)),
    );
    for (const page of recoverableSources) {
      expect(page).toContain("Réessayer");
    }
  });
});
