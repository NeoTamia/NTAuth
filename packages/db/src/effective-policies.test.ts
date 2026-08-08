import { describe, expect, test } from "bun:test";

import { mergeEffectivePolicies, type EffectivePolicyRow } from "./effective-policies";

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
});
