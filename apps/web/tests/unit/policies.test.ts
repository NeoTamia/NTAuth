import { describe, expect, test } from "bun:test";

import {
  emptyPolicyDocument,
  identifierLines,
  parsePolicyJson,
  policyDiff,
  policyJson,
  validateEditablePolicy,
} from "@/utils/policies";

const service = "reports";
const context = {
  actions: new Set([`${service}:report:read`, `${service}:report:write`]),
  expectedService: service,
  resources: new Set([`${service}:report:*`]),
};
const document = {
  statements: [
    {
      actions: [`${service}:report:read`],
      effect: "Allow" as const,
      resources: [`${service}:report:*`],
    },
  ],
  version: "2026-01-01" as const,
};

describe("policy editor", () => {
  test("round-trips valid JSON without dropping conditions", () => {
    const conditioned = {
      ...document,
      statements: [
        {
          ...document.statements[0]!,
          conditions: { StringEquals: { "user.id": "user-1" } },
        },
      ],
    };
    const parsed = parsePolicyJson(policyJson(conditioned), context);
    expect(parsed.issues).toEqual([]);
    expect(parsed.document).toEqual(conditioned);
  });

  test("returns localized paths and prevents invalid catalogue entries", () => {
    const result = validateEditablePolicy(
      {
        ...document,
        statements: [{ ...document.statements[0]!, actions: [`${service}:report:delete`] }],
      },
      context,
    );
    expect(result.document).toBeUndefined();
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "catalogue", path: "$.statements[0].actions[0]" }),
    );
    expect(parsePolicyJson("{", context).issues[0]?.message).toContain("JSON valide");
  });

  test("normalizes visual lists and summarizes version differences", () => {
    expect(identifierLines("reports:read\nreports:read\n reports:write ")).toEqual([
      "reports:read",
      "reports:write",
    ]);
    const next = emptyPolicyDocument();
    next.statements[0] = { ...document.statements[0]!, effect: "Deny" };
    expect(policyDiff(document, next)).toContain("Effets Allow/Deny modifiés.");
  });

  test("keeps protected policy operations, validation and accessible states visible", async () => {
    const [page, styles] = await Promise.all([
      Bun.file(new URL("../../app/pages/admin/policies.vue", import.meta.url)).text(),
      Bun.file(new URL("../../app/assets/css/main.css", import.meta.url)).text(),
    ]);
    for (const path of [
      "/api/v1/organizations",
      "/api/v1/iam/catalog/",
      "/api/v1/iam/policies",
      "/history",
    ])
      expect(page).toContain(path);
    expect(page.match(/challengeHeaders/g)?.length).toBeGreaterThanOrEqual(4);
    expect(page).toContain("catalogue_not_found");
    expect(page).toContain("Aucun catalogue actif ne correspond à cette clé");
    expect(page).toContain('to="/admin/catalogue"');
    expect(page).toContain("policy_conflict");
    expect(page).toContain("validateEditablePolicy");
    expect(page).toContain('aria-live="polite"');
    expect(page).toContain('role="alert"');
    expect(page).toContain("scrollIntoView");
    for (const [, pattern] of page.matchAll(/\bpattern="([^"]+)"/g)) {
      expect(() => new RegExp(`^(?:${pattern})$`, "v")).not.toThrow();
    }
    expect(styles).toMatch(/\.access-gate form\s*{[^}]*gap: 1\.25rem;/);
  });
});
