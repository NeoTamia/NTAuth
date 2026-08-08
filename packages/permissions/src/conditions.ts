import type { PolicyStatement } from "./iam";

export const POLICY_CONDITION_VARIABLE_TYPES = Object.freeze({
  "organization.id": "string",
  "organization.role": "string",
  "organization.slug": "string",
  "service.environment": "string",
  "service.key": "string",
  "user.email": "string",
  "user.email_verified": "boolean",
  "user.id": "string",
  "user.name": "string",
} as const);

export type PolicyConditionVariable = keyof typeof POLICY_CONDITION_VARIABLE_TYPES;
export type PolicyConditionContext = {
  organization?: Partial<Record<"id" | "role" | "slug", string>>;
  service?: Partial<Record<"environment" | "key", string>>;
  user?: Partial<Record<"email" | "id" | "name", string> & Record<"email_verified", boolean>>;
};

const stringOperators = new Set(["StringEquals", "StringLike", "StringNotEquals"]);

export function isPolicyConditionVariable(value: string): value is PolicyConditionVariable {
  return Object.hasOwn(POLICY_CONDITION_VARIABLE_TYPES, value);
}

export function policyConditionVariableType(value: PolicyConditionVariable) {
  return POLICY_CONDITION_VARIABLE_TYPES[value];
}

function contextValue(context: PolicyConditionContext, variable: PolicyConditionVariable) {
  const [namespace, key] = variable.split(".") as [keyof PolicyConditionContext, string];
  const values = context[namespace] as Record<string, unknown> | undefined;
  return values?.[key];
}

function wildcardPattern(pattern: string) {
  let source = "^";
  for (const character of pattern) {
    if (character === "*") source += ".*";
    else if (character === "?") source += ".";
    else source += character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }
  return new RegExp(`${source}$`, "u");
}

function expectedStrings(value: unknown): string[] | undefined {
  const values = Array.isArray(value) ? value : [value];
  return values.length > 0 && values.every((entry) => typeof entry === "string")
    ? values
    : undefined;
}

export function evaluatePolicyConditions(
  conditions: PolicyStatement["conditions"],
  context: PolicyConditionContext,
) {
  if (!conditions || Object.keys(conditions).length === 0) return true;
  for (const [operator, entries] of Object.entries(conditions)) {
    if (
      (operator !== "Bool" && !stringOperators.has(operator)) ||
      !entries ||
      typeof entries !== "object" ||
      Object.keys(entries).length === 0
    ) {
      return false;
    }
    for (const [variable, expected] of Object.entries(entries)) {
      if (!isPolicyConditionVariable(variable)) return false;
      const actual = contextValue(context, variable);
      if (actual === undefined) return false;
      if (operator === "Bool") {
        if (typeof actual !== "boolean" || typeof expected !== "boolean" || actual !== expected) {
          return false;
        }
        continue;
      }
      if (typeof actual !== "string") return false;
      const expectedValues = expectedStrings(expected);
      if (!expectedValues) return false;
      if (operator === "StringEquals" && !expectedValues.includes(actual)) return false;
      if (operator === "StringNotEquals" && expectedValues.includes(actual)) return false;
      if (
        operator === "StringLike" &&
        !expectedValues.some((pattern) => wildcardPattern(pattern).test(actual))
      ) {
        return false;
      }
    }
  }
  return true;
}
