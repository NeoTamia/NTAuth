import { describe, expect, test } from "bun:test";

import { auditActionLabel, auditOutcomeLabel, exclusiveDayAfter } from "@/utils/audit-events";

describe("audit event consultation", () => {
  test("labels redacted events and builds an exclusive end date", () => {
    expect(auditOutcomeLabel("success")).toBe("Autorisé");
    expect(auditOutcomeLabel("denied")).toBe("Refusé");
    expect(auditActionLabel("service-grant.status.change")).toBe("Grant · status › change");
    expect(exclusiveDayAfter("2026-08-08")).toBe("2026-08-09T00:00:00.000Z");
  });

  test("keeps scope, stable pagination, redaction and export protection visible", async () => {
    const page = await Bun.file(
      new URL("../../app/pages/admin/audit-events.vue", import.meta.url),
    ).text();
    expect(page).toContain("/api/v1/audit-events/scopes");
    expect(page).toContain("/api/v1/audit-events/export");
    expect(page.match(/challengeHeaders/g)?.length).toBeGreaterThanOrEqual(3);
    expect(page).toContain("pageCursors");
    expect(page).toContain("confirmExport");
    expect(page).toContain("URL.createObjectURL");
    expect(page).toContain('role="alert"');
    expect(page).toContain('aria-live="polite"');
    expect(page).not.toContain("password");
    expect(page).not.toContain("token");
  });
});
