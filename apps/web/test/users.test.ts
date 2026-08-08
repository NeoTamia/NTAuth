import { describe, expect, test } from "bun:test";

import { sessionState, sessionStateLabel, userStatusLabel } from "../app/utils/users";

describe("user administration", () => {
  test("labels lifecycle and session states in French", () => {
    expect(userStatusLabel("deactivated")).toBe("Désactivé");
    expect(userStatusLabel("suspended")).toBe("Suspendu");
    expect(sessionState("2030-01-01T00:00:00.000Z", new Date("2029-01-01"))).toBe("active");
    expect(sessionStateLabel("2020-01-01T00:00:00.000Z", new Date("2029-01-01"))).toBe("Expirée");
  });

  test("keeps registry, detail and mutations behind fresh MFA and confirmations", async () => {
    const page = await Bun.file(new URL("../app/pages/admin/users.vue", import.meta.url)).text();
    for (const path of ["/api/v1/users", "/sessions/revoke", "/status"])
      expect(page).toContain(path);
    expect(page.match(/mfaChallengeHeaders/g)?.length).toBeGreaterThanOrEqual(4);
    expect(page).toContain("confirmStatus");
    expect(page).toContain("confirmRevocation");
    expect(page).toContain("nextOffset");
    expect(page).toContain('role="alert"');
    expect(page).toContain('aria-live="polite"');
    expect(page).toContain("scrollIntoView");
  });
});
