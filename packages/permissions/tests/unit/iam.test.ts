import { describe, expect, test } from "bun:test";

import {
  POLICY_DOCUMENT_VERSION,
  POLICY_LIMITS,
  PolicyValidationError,
  parsePolicyDocument,
  validatePolicyDocument,
  type PolicyDocument,
} from "@/iam";

function policy(overrides: Partial<PolicyDocument> = {}): PolicyDocument {
  return {
    statements: [
      {
        actions: ["ntscout:report:read"],
        effect: "Allow",
        resources: ["ntscout:report:*"],
        sid: "ReadReports",
      },
    ],
    version: POLICY_DOCUMENT_VERSION,
    ...overrides,
  };
}

function issuePaths(input: unknown) {
  const result = validatePolicyDocument(input);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.issues.map((issue) => `${issue.code}:${issue.path}`);
}

describe("IAM policy document validation", () => {
  test("parses the documented V1 example with strict service catalogues", () => {
    const input = policy({
      statements: [
        {
          actions: ["ntscout:report:read"],
          conditions: {
            Bool: { "user.email_verified": true },
            StringEquals: { "organization.id": "org_123" },
          },
          effect: "Allow",
          resources: ["ntscout:report:*"],
          sid: "ReadOwnReports",
        },
      ],
    });
    expect(
      parsePolicyDocument(input, {
        actions: new Set(["ntscout:report:read"]),
        expectedService: "ntscout",
        resources: new Set(["ntscout:report:*"]),
      }),
    ).toEqual(input);
  });

  test("accepts Deny and each declared condition operator", () => {
    const result = validatePolicyDocument(
      policy({
        statements: [
          {
            actions: ["ntscout:report:*"],
            conditions: {
              Bool: { "user.email_verified": false },
              StringEquals: { "organization.id": ["org_a", "org_b"] },
              StringLike: { "user.email": "*@example.test" },
              StringNotEquals: { "service.environment": "development" },
            },
            effect: "Deny",
            resources: ["ntscout:report:*"],
          },
        ],
      }),
    );
    expect(result).toMatchObject({ ok: true });
  });

  test("rejects unknown fields at every policy level", () => {
    expect(issuePaths({ ...policy(), tenant: "other" })).toContain("unknown:$.tenant");
    expect(
      issuePaths({
        ...policy(),
        statements: [{ ...policy().statements[0], principal: "user" }],
      }),
    ).toContain("unknown:$.statements[0].principal");
  });

  test("rejects unsupported versions, effects and malformed roots", () => {
    expect(issuePaths(null)).toContain("type:$");
    expect(issuePaths({ statements: [], version: "2012-10-17" })).toContain("format:$.version");
    expect(
      issuePaths({
        statements: [{ actions: [], effect: "Permit", resources: [] }],
        version: POLICY_DOCUMENT_VERSION,
      }),
    ).toEqual(
      expect.arrayContaining([
        "format:$.statements[0].effect",
        "required:$.statements[0].actions",
        "required:$.statements[0].resources",
      ]),
    );
  });

  test("rejects malformed identifiers and non-terminal wildcards", () => {
    const invalid = policy({
      statements: [
        {
          actions: ["NTScout:report:read", "ntscout:*:read"],
          effect: "Allow",
          resources: ["*:report:1", "ntscout:report:*:field"],
        },
      ],
    });
    expect(issuePaths(invalid)).toEqual(
      expect.arrayContaining([
        "format:$.statements[0].actions[0]",
        "format:$.statements[0].actions[1]",
        "format:$.statements[0].resources[0]",
        "format:$.statements[0].resources[1]",
      ]),
    );
  });

  test("rejects duplicates with localized paths", () => {
    const invalid = policy({
      statements: [
        {
          actions: ["ntscout:report:read", "ntscout:report:read"],
          effect: "Allow",
          resources: ["ntscout:report:*", "ntscout:report:*"],
          sid: "Same",
        },
        {
          actions: ["ntscout:report:write"],
          effect: "Deny",
          resources: ["ntscout:report:*"],
          sid: "Same",
        },
      ],
    });
    expect(issuePaths(invalid)).toEqual(
      expect.arrayContaining([
        "duplicate:$.statements[0].actions[1]",
        "duplicate:$.statements[0].resources[1]",
        "duplicate:$.statements[1].sid",
      ]),
    );
  });

  test("rejects cross-service and out-of-catalogue entries fail-closed", () => {
    const crossService = validatePolicyDocument(policy(), {
      expectedService: "inventory",
    });
    expect(crossService.ok).toBe(false);
    if (crossService.ok) return;
    expect(crossService.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["scope", "scope"]),
    );

    const outsideCatalogue = validatePolicyDocument(policy(), {
      actions: new Set(["ntscout:report:write"]),
      expectedService: "ntscout",
      resources: new Set(["ntscout:report:1"]),
    });
    expect(outsideCatalogue.ok).toBe(false);
    if (outsideCatalogue.ok) return;
    expect(outsideCatalogue.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["catalogue", "catalogue"]),
    );
  });

  test("rejects unknown condition operators, variables and invalid types", () => {
    const invalid = policy({
      statements: [
        {
          actions: ["ntscout:report:read"],
          conditions: {
            Bool: { "request.secure": "true" as unknown as boolean },
            NumericEquals: { "user.age": 18 },
            StringEquals: { "user.id": false },
          } as never,
          effect: "Allow",
          resources: ["ntscout:report:*"],
        },
      ],
    });
    expect(issuePaths(invalid)).toEqual(
      expect.arrayContaining([
        "type:$.statements[0].conditions.Bool.request.secure",
        "format:$.statements[0].conditions.Bool.request.secure",
        "unknown:$.statements[0].conditions.NumericEquals",
        "type:$.statements[0].conditions.StringEquals.user.id",
      ]),
    );
  });

  test("enforces statement, identifier and document boundaries", () => {
    const maximum = policy({
      statements: Array.from({ length: POLICY_LIMITS.statements }, (_, index) => ({
        actions: [`ntscout:action-${index}`],
        effect: "Allow" as const,
        resources: [`ntscout:resource-${index}`],
        sid: `Statement_${index}`,
      })),
    });
    expect(validatePolicyDocument(maximum).ok).toBe(true);

    const tooMany = policy({
      statements: [
        ...maximum.statements,
        { actions: ["ntscout:extra"], effect: "Allow", resources: ["ntscout:extra"] },
      ],
    });
    expect(issuePaths(tooMany)).toContain("limit:$.statements");

    const oversized = { ...policy(), padding: "x".repeat(POLICY_LIMITS.documentBytes) };
    expect(issuePaths(oversized)).toContain("limit:$");
  });

  test("enforces every per-statement collection boundary", () => {
    const actions = Array.from(
      { length: POLICY_LIMITS.actionsPerStatement },
      (_, index) => `ntscout:action-${index}`,
    );
    const resources = Array.from(
      { length: POLICY_LIMITS.resourcesPerStatement },
      (_, index) => `ntscout:resource-${index}`,
    );
    const conditionValues = Array.from(
      { length: POLICY_LIMITS.conditionValuesPerKey },
      (_, index) => `value-${index}`,
    );
    const maximum = policy({
      statements: [
        {
          actions,
          conditions: {
            Bool: { "user.email_verified": true },
            StringEquals: {
              "organization.id": "organization",
              "organization.role": "member",
              "organization.slug": "organization",
              "service.environment": "production",
              "service.key": "ntscout",
              "user.email": "user@example.test",
              "user.id": conditionValues,
              "user.name": "User",
            },
            StringLike: {
              "organization.id": "org*",
              "organization.role": "mem*",
              "organization.slug": "org*",
              "service.environment": "prod*",
              "service.key": "nt*",
              "user.email": "*@example.test",
              "user.id": "user*",
              "user.name": "U*",
            },
            StringNotEquals: {
              "organization.id": "other",
              "service.environment": "development",
              "user.id": "other",
            },
          },
          effect: "Allow",
          resources,
          sid: "S".repeat(POLICY_LIMITS.sidLength),
        },
      ],
    });
    expect(validatePolicyDocument(maximum).ok).toBe(true);

    const excessive = structuredClone(maximum);
    excessive.statements[0]!.actions.push("ntscout:action-extra");
    excessive.statements[0]!.resources.push("ntscout:resource-extra");
    excessive.statements[0]!.conditions!.StringEquals!["user.id"] = [
      ...conditionValues,
      "value-extra",
    ];
    excessive.statements[0]!.sid = "S".repeat(POLICY_LIMITS.sidLength + 1);
    expect(issuePaths(excessive)).toEqual(
      expect.arrayContaining([
        "limit:$.statements[0].actions",
        "limit:$.statements[0].resources",
        "limit:$.statements[0].conditions.StringEquals.user.id",
        "format:$.statements[0].sid",
      ]),
    );
  });

  test("rejects empty operators and duplicate condition values", () => {
    const invalid = policy({
      statements: [
        {
          actions: ["ntscout:report:read"],
          conditions: {
            StringEquals: { "user.id": ["same", "same"] },
            StringLike: {},
          },
          effect: "Allow",
          resources: ["ntscout:report:*"],
        },
      ],
    });
    expect(issuePaths(invalid)).toEqual(
      expect.arrayContaining([
        "duplicate:$.statements[0].conditions.StringEquals.user.id",
        "required:$.statements[0].conditions.StringLike",
      ]),
    );
  });

  test("throws one typed fail-closed error and rejects cyclic input", () => {
    expect(() => parsePolicyDocument({ statements: [], version: "invalid" })).toThrow(
      PolicyValidationError,
    );
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const result = validatePolicyDocument(cyclic);
    expect(result).toEqual({
      issues: [{ code: "type", message: "policy must be JSON serializable", path: "$" }],
      ok: false,
    });
  });
});
