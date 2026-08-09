import { describe, expect, test } from "bun:test";

import { evaluatePolicy, matchesPolicyIdentifier } from "../../src/evaluator";
import type { PolicyStatement } from "../../src/iam";

const context = {
  organization: { id: "org_123", role: "member", slug: "acme" },
  service: { environment: "production", key: "ntscout" },
  user: {
    email: "alice@example.test",
    email_verified: true,
    id: "user_alice",
    name: "Alice",
  },
} as const;

const allowReports: PolicyStatement = {
  actions: ["ntscout:report:*"],
  effect: "Allow",
  resources: ["ntscout:report:*"],
  sid: "AllowReports",
};

function decide(
  statements: PolicyStatement[],
  overrides: Partial<{ action: string; resource: string }> = {},
) {
  return evaluatePolicy({
    action: overrides.action ?? "ntscout:report:read",
    context,
    resource: overrides.resource ?? "ntscout:report:report-123",
    statements,
  });
}

describe("IAM Allow/Deny evaluator", () => {
  test("allows one matching statement and explains the decision", () => {
    expect(decide([allowReports])).toEqual({
      allowed: true,
      matchedAllowStatements: ["AllowReports"],
      matchedDenyStatements: [],
      reason: "explicit_allow",
    });
  });

  test("gives every explicit Deny priority independently of input order", () => {
    const deny: PolicyStatement = {
      actions: ["ntscout:report:read"],
      effect: "Deny",
      resources: ["ntscout:report:report-123"],
      sid: "DenySensitiveReport",
    };
    for (const statements of [
      [allowReports, deny],
      [deny, allowReports],
    ]) {
      expect(decide(statements)).toEqual({
        allowed: false,
        matchedAllowStatements: ["AllowReports"],
        matchedDenyStatements: ["DenySensitiveReport"],
        reason: "explicit_deny",
      });
    }
  });

  test("uses implicit Deny when no Allow matches or the request is malformed", () => {
    expect(decide([]).reason).toBe("implicit_deny");
    expect(decide([allowReports], { action: "ntscout:report:delete" }).allowed).toBe(true);
    expect(decide([allowReports], { action: "ntscout:user:read" })).toMatchObject({
      allowed: false,
      reason: "implicit_deny",
    });
    expect(decide([allowReports], { action: "ntscout:report:*" })).toMatchObject({
      allowed: false,
      reason: "implicit_deny",
    });
  });

  test("matches only exact identifiers or complete terminal wildcard segments", () => {
    expect(matchesPolicyIdentifier("ntscout:report:*", "ntscout:report:read")).toBe(true);
    expect(matchesPolicyIdentifier("ntscout:report:*", "ntscout:reports:read")).toBe(false);
    expect(matchesPolicyIdentifier("ntscout:report:read", "ntscout:report:read")).toBe(true);
    expect(matchesPolicyIdentifier("ntscout:report:read", "ntscout:report:read-all")).toBe(false);
    expect(matchesPolicyIdentifier("ntscout:*:read", "ntscout:report:read")).toBe(false);
  });

  test("requires conditions and fails closed when their context is missing", () => {
    const conditional: PolicyStatement = {
      ...allowReports,
      conditions: {
        Bool: { "user.email_verified": true },
        StringEquals: { "organization.id": "org_123" },
      },
      sid: "ConditionalAllow",
    };
    expect(decide([conditional]).allowed).toBe(true);
    expect(
      evaluatePolicy({
        action: "ntscout:report:read",
        context: { organization: { id: "org_123" } },
        resource: "ntscout:report:report-123",
        statements: [conditional],
      }).reason,
    ).toBe("implicit_deny");
  });

  test("keeps explanations stable for every permutation of named statements", () => {
    const statements = Array.from({ length: 12 }, (_, index): PolicyStatement => ({
      actions: [index % 2 === 0 ? "ntscout:report:*" : "ntscout:user:*"],
      effect: index % 3 === 0 ? "Deny" : "Allow",
      resources: ["ntscout:report:*"],
      sid: `Statement_${String(index).padStart(2, "0")}`,
    }));
    const forward = decide(statements);
    const permutations = [
      statements.toReversed(),
      ...statements.map((_, offset) =>
        statements.slice(offset).concat(statements.slice(0, offset)),
      ),
    ];
    for (const permutation of permutations) expect(decide(permutation)).toEqual(forward);
    expect(forward.matchedAllowStatements).toEqual([...forward.matchedAllowStatements].toSorted());
    expect(forward.matchedDenyStatements).toEqual([...forward.matchedDenyStatements].toSorted());
  });
});
