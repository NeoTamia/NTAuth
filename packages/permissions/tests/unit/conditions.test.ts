import { describe, expect, test } from "bun:test";

import { evaluatePolicyConditions } from "../../src/conditions";
import { validatePolicyDocument, type PolicyStatement } from "../../src/iam";

const context = {
  organization: { id: "org_123", role: "member", slug: "acme" },
  service: { environment: "production", key: "ntscout" },
  user: {
    email: "alice+reports@example.test",
    email_verified: true,
    id: "user_alice",
    name: "Alice",
  },
} as const;

function matches(conditions: PolicyStatement["conditions"]) {
  return evaluatePolicyConditions(conditions, context);
}

function policyWithConditions(conditions: unknown) {
  return {
    statements: [
      {
        actions: ["ntscout:report:read"],
        conditions,
        effect: "Allow",
        resources: ["ntscout:report:*"],
      },
    ],
    version: "2026-01-01",
  };
}

describe("IAM V1 conditions", () => {
  test("matches all supported operators with AND semantics", () => {
    expect(
      matches({
        Bool: { "user.email_verified": true },
        StringEquals: {
          "organization.id": ["org_other", "org_123"],
          "service.key": "ntscout",
        },
        StringLike: {
          "organization.slug": "ac?e",
          "user.email": "alice+*@example.test",
        },
        StringNotEquals: { "service.environment": ["test", "development"] },
      }),
    ).toBe(true);
  });

  test("treats wildcard patterns as anchored and escapes regex characters", () => {
    expect(matches({ StringLike: { "user.email": "alice+*@example.test" } })).toBe(true);
    expect(matches({ StringLike: { "user.email": "alice.*@example.test" } })).toBe(false);
    expect(matches({ StringLike: { "organization.slug": "cm" } })).toBe(false);
  });

  test("fails closed for every mismatch, missing value and malformed operator", () => {
    expect(matches({ StringEquals: { "organization.id": "other" } })).toBe(false);
    expect(matches({ StringNotEquals: { "organization.role": "member" } })).toBe(false);
    expect(matches({ Bool: { "user.email_verified": false } })).toBe(false);
    expect(
      evaluatePolicyConditions(
        { StringEquals: { "organization.slug": "acme" } },
        { organization: {} },
      ),
    ).toBe(false);
    expect(matches({ Unknown: { "user.id": "user_alice" } } as never)).toBe(false);
    expect(matches({ StringEquals: {} })).toBe(false);
  });

  test("accepts no conditions and rejects undeclared or mistyped variables at validation", () => {
    expect(matches(undefined)).toBe(true);
    expect(
      validatePolicyDocument(policyWithConditions({ StringEquals: { "request.ip": "127.0.0.1" } }))
        .ok,
    ).toBe(false);
    expect(
      validatePolicyDocument(policyWithConditions({ Bool: { "organization.id": true } })).ok,
    ).toBe(false);
    expect(
      validatePolicyDocument(
        policyWithConditions({ StringEquals: { "user.email_verified": "true" } }),
      ).ok,
    ).toBe(false);
  });
});
