import { describe, expect, test } from "bun:test";

import {
  membershipStatusLabel,
  organizationRoleLabel,
  organizationSlug,
} from "../app/utils/organizations";

describe("organization administration", () => {
  test("derives stable slugs and French role labels", () => {
    expect(organizationSlug("Équipe NéoTamia — Réunion")).toBe("equipe-neotamia-reunion");
    expect(organizationSlug("  Tenant__Principal  ")).toBe("tenant-principal");
    expect(organizationRoleLabel("owner")).toBe("Propriétaire");
    expect(organizationRoleLabel("admin")).toBe("Administrateur");
    expect(membershipStatusLabel("suspended")).toBe("Suspendu");
  });

  test("keeps every tenant read and mutation behind a fresh MFA challenge", async () => {
    const page = await Bun.file(
      new URL("../app/pages/admin/organizations.vue", import.meta.url),
    ).text();
    for (const path of ["/api/v1/organizations", "/api/v1/invitations", "/members/"])
      expect(page).toContain(path);
    expect(page.match(/mfaChallengeHeaders/g)?.length).toBeGreaterThanOrEqual(7);
    expect(page).toContain("confirmCancel");
    expect(page).toContain("organization_conflict");
    expect(page).toContain('role="alert"');
    expect(page).toContain('aria-live="polite"');
    expect(page).toContain("scrollIntoView");
  });
});
