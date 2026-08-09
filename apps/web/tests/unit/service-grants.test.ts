import { describe, expect, test } from "bun:test";

import { matchesGrantSearch, serviceGrantStatusLabel } from "@/utils/service-grants";

describe("service grant administration", () => {
  test("labels every lifecycle state and searches service or subject", () => {
    expect(serviceGrantStatusLabel("active")).toBe("Actif");
    expect(serviceGrantStatusLabel("inactive")).toBe("Suspendu");
    expect(serviceGrantStatusLabel("revoked")).toBe("Révoqué");
    expect(matchesGrantSearch("lagon", ["NTScout", "Lagon Team", "alice@example.test"])).toBe(true);
    expect(matchesGrantSearch("absent", ["NTScout", "Alice"])).toBe(false);
  });

  test("keeps protected reads and mutations explicit in the interface", async () => {
    const page = await Bun.file(
      new URL("../../app/pages/admin/service-grants.vue", import.meta.url),
    ).text();
    expect(page).toContain("/api/v1/service-grants/administration");
    expect(page.match(/challengeHeaders/g)?.length).toBeGreaterThanOrEqual(4);
    expect(page).toContain("confirmAction");
    expect(page).toContain('role="alert"');
    expect(page).toContain('aria-live="polite"');
    expect(page).toContain("loading");
    expect(page).toContain("forbidden");
  });
});
