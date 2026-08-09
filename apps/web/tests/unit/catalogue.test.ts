import { describe, expect, test } from "bun:test";

import { isPolicyIdentifier } from "@neotamia/permissions";

describe("IAM catalogue administration", () => {
  test("validates catalogue identifiers against their kind and service", () => {
    expect(isPolicyIdentifier("ntscout:report:read", "action", "ntscout")).toBe(true);
    expect(isPolicyIdentifier("ntscout:report:*", "resource", "ntscout")).toBe(true);
    expect(isPolicyIdentifier("other:report:read", "action", "ntscout")).toBe(false);
    expect(isPolicyIdentifier("ntscout:*:read", "resource", "ntscout")).toBe(false);
  });

  test("exposes the protected service and catalogue lifecycle accessibly", async () => {
    const [page, styles] = await Promise.all([
      Bun.file(new URL("../../app/pages/admin/catalogue.vue", import.meta.url)).text(),
      Bun.file(new URL("../../app/assets/css/main.css", import.meta.url)).text(),
    ]);

    for (const path of ["/api/v1/iam/catalog", "/api/v1/services", "/api/v1/users?status=active"])
      expect(page).toContain(path);
    expect(page.match(/challengeHeaders/g)?.length).toBeGreaterThanOrEqual(5);
    expect(page).toContain('method: "POST"');
    expect(page).toContain('method: "PATCH"');
    expect(page).toContain("catalogue_conflict");
    expect(page).toContain("loadActiveOwners");
    expect(page).not.toContain("ownerFor(created.ownerUserId)!");
    expect(page).toContain('role="status"');
    expect(page).toContain("isPolicyIdentifier");
    expect(page).toContain('aria-live="polite"');
    expect(page).toContain('role="alert"');
    expect(page).toContain("scrollIntoView");
    for (const [, pattern] of page.matchAll(/\bpattern="([^"]+)"/g)) {
      expect(() => new RegExp(`^(?:${pattern})$`, "v")).not.toThrow();
    }
    expect(styles).toContain(".catalogue-workspace");
    expect(styles).toContain(".catalogue-entry-columns");
  });
});
