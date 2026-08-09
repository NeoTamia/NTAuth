import { describe, expect, test } from "bun:test";

import {
  calculateEffectivePolicyEtag,
  mergeEffectivePolicies,
  type EffectivePolicyFingerprint,
  type EffectivePolicyRow,
} from "@/effective-policies";

const row = (
  policyId: string,
  policyName: string,
  effect: "Allow" | "Deny",
): EffectivePolicyRow => ({
  document: {
    statements: [
      {
        actions: ["ntscout:report:read"],
        effect,
        resources: ["ntscout:report:*"],
      },
    ],
    version: "2026-01-01",
  },
  documentHash: policyId.repeat(64).slice(0, 64),
  policyId,
  policyName,
  version: 1,
});

describe("effective policy merge", () => {
  test("deduplicates principals and sorts policies before flattening statements", () => {
    const merged = mergeEffectivePolicies([
      row("b", "Zulu", "Allow"),
      row("a", "Alpha", "Deny"),
      row("b", "Zulu", "Allow"),
    ]);
    expect(merged.policies.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(merged.statements.map(({ effect }) => effect)).toEqual(["Deny", "Allow"]);
  });

  test("returns stable empty collections without mutating its input", () => {
    const input: EffectivePolicyRow[] = [];
    expect(mergeEffectivePolicies(input)).toEqual({ policies: [], statements: [] });
    expect(input).toEqual([]);
  });

  test("produces stable strong ETags and changes every decision input", async () => {
    const fingerprint: EffectivePolicyFingerprint = {
      grantId: "grant-1",
      groupIds: ["group-1"],
      organizationId: "organization-1",
      organizationSlug: "acme",
      policies: [{ documentHash: "a".repeat(64), id: "policy-1", version: 1 }],
      role: "member",
      service: "ntscout",
      subjectName: "Alice",
      subjectUserId: "user-1",
    };
    const etag = await calculateEffectivePolicyEtag(fingerprint);
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    await expect(calculateEffectivePolicyEtag(structuredClone(fingerprint))).resolves.toBe(etag);
    const variants: EffectivePolicyFingerprint[] = [
      { ...fingerprint, grantId: null },
      { ...fingerprint, groupIds: ["group-2"] },
      { ...fingerprint, organizationSlug: "renamed" },
      { ...fingerprint, role: "admin" },
      { ...fingerprint, subjectName: "Alicia" },
      {
        ...fingerprint,
        policies: [{ documentHash: "b".repeat(64), id: "policy-1", version: 2 }],
      },
    ];
    const changed = await Promise.all(variants.map(calculateEffectivePolicyEtag));
    expect(new Set(changed).size).toBe(variants.length);
    expect(changed).not.toContain(etag);
  });
});
