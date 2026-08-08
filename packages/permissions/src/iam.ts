import { isPolicyConditionVariable, policyConditionVariableType } from "./conditions";

export const POLICY_DOCUMENT_VERSION = "2026-01-01" as const;

export const POLICY_LIMITS = Object.freeze({
  actionsPerStatement: 50,
  conditionKeysPerStatement: 20,
  conditionValuesPerKey: 20,
  documentBytes: 64 * 1024,
  identifierLength: 256,
  resourcesPerStatement: 100,
  sidLength: 64,
  statements: 100,
} as const);

export const POLICY_CONDITION_OPERATORS = Object.freeze([
  "StringEquals",
  "StringLike",
  "StringNotEquals",
  "Bool",
] as const);

export type PolicyConditionOperator = (typeof POLICY_CONDITION_OPERATORS)[number];
export type PolicyEffect = "Allow" | "Deny";
export type PolicyConditionValue = boolean | string | string[];

export interface PolicyStatement {
  sid?: string;
  effect: PolicyEffect;
  actions: string[];
  resources: string[];
  conditions?: Partial<Record<PolicyConditionOperator, Record<string, PolicyConditionValue>>>;
}

export interface PolicyDocument {
  version: typeof POLICY_DOCUMENT_VERSION;
  statements: PolicyStatement[];
}

export type PolicyValidationIssue = {
  code: "catalogue" | "duplicate" | "format" | "limit" | "required" | "scope" | "type" | "unknown";
  message: string;
  path: string;
};

export type PolicyValidationResult =
  | { issues: []; ok: true; value: PolicyDocument }
  | { issues: PolicyValidationIssue[]; ok: false };

export type PolicyValidationContext = {
  actions?: ReadonlySet<string>;
  expectedService?: string;
  resources?: ReadonlySet<string>;
};

const documentKeys = new Set(["version", "statements"]);
const statementKeys = new Set(["sid", "effect", "actions", "resources", "conditions"]);
const conditionOperators = new Set<string>(POLICY_CONDITION_OPERATORS);
const servicePattern = /^[a-z][a-z0-9-]{0,62}$/;
const actionSegmentPattern = /^[a-z][a-z0-9-]{0,62}$/;
const resourceSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addIssue(
  issues: PolicyValidationIssue[],
  path: string,
  code: PolicyValidationIssue["code"],
  message: string,
) {
  issues.push({ code, message, path });
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  issues: PolicyValidationIssue[],
) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) addIssue(issues, `${path}.${key}`, "unknown", "unknown field");
  }
}

function splitIdentifier(value: string) {
  const [service, ...segments] = value.split(":");
  return { segments, service: service ?? "" };
}

export function isPolicyIdentifier(
  value: string,
  kind: "action" | "resource",
  expectedService?: string,
) {
  if (value.length === 0 || value.length > POLICY_LIMITS.identifierLength) return false;
  const { segments, service } = splitIdentifier(value);
  const segmentPattern = kind === "action" ? actionSegmentPattern : resourceSegmentPattern;
  const wildcardIndex = segments.indexOf("*");
  return (
    servicePattern.test(service) &&
    (!expectedService || service === expectedService) &&
    segments.length > 0 &&
    segments.every((segment) => segment === "*" || segmentPattern.test(segment)) &&
    (wildcardIndex === -1 || wildcardIndex === segments.length - 1) &&
    segments.filter((segment) => segment === "*").length <= 1
  );
}

function validateIdentifier(
  value: unknown,
  kind: "action" | "resource",
  path: string,
  context: PolicyValidationContext,
  issues: PolicyValidationIssue[],
) {
  if (typeof value !== "string") {
    addIssue(issues, path, "type", `${kind} must be a string`);
    return;
  }
  if (value.length === 0 || value.length > POLICY_LIMITS.identifierLength) {
    addIssue(issues, path, "limit", `${kind} length is invalid`);
    return;
  }
  const { service } = splitIdentifier(value);
  if (!isPolicyIdentifier(value, kind)) {
    addIssue(issues, path, "format", `${kind} identifier or wildcard is invalid`);
    return;
  }
  if (context.expectedService && service !== context.expectedService) {
    addIssue(issues, path, "scope", `${kind} belongs to another service`);
    return;
  }
  const catalogue = kind === "action" ? context.actions : context.resources;
  if (catalogue && !catalogue.has(value)) {
    addIssue(issues, path, "catalogue", `${kind} is not declared in the service catalogue`);
  }
}

function validateStringArray(
  value: unknown,
  path: string,
  maximum: number,
  kind: "action" | "resource",
  context: PolicyValidationContext,
  issues: PolicyValidationIssue[],
) {
  if (!Array.isArray(value)) {
    addIssue(issues, path, "type", `${path} must be an array`);
    return;
  }
  if (value.length === 0) addIssue(issues, path, "required", `${path} must not be empty`);
  if (value.length > maximum) addIssue(issues, path, "limit", `${path} exceeds its limit`);
  const seen = new Set<unknown>();
  value.forEach((entry, index) => {
    validateIdentifier(entry, kind, `${path}[${index}]`, context, issues);
    if (seen.has(entry)) addIssue(issues, `${path}[${index}]`, "duplicate", `duplicate ${kind}`);
    seen.add(entry);
  });
}

function validateConditionValue(
  operator: string,
  value: unknown,
  path: string,
  issues: PolicyValidationIssue[],
) {
  if (operator === "Bool") {
    if (typeof value !== "boolean") addIssue(issues, path, "type", "Bool requires a boolean");
    return;
  }
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0 || values.length > POLICY_LIMITS.conditionValuesPerKey) {
    addIssue(issues, path, "limit", "condition value count is invalid");
  }
  if (
    values.some(
      (entry) =>
        typeof entry !== "string" ||
        entry.length === 0 ||
        entry.length > POLICY_LIMITS.identifierLength,
    )
  ) {
    addIssue(issues, path, "type", `${operator} requires a string or non-empty string array`);
  }
  if (new Set(values).size !== values.length) {
    addIssue(issues, path, "duplicate", "condition values must be unique");
  }
}

function validateConditions(value: unknown, path: string, issues: PolicyValidationIssue[]) {
  if (!isRecord(value)) {
    addIssue(issues, path, "type", "conditions must be an object");
    return;
  }
  let conditionKeyCount = 0;
  for (const [operator, entries] of Object.entries(value)) {
    if (!conditionOperators.has(operator)) {
      addIssue(issues, `${path}.${operator}`, "unknown", "unsupported condition operator");
      continue;
    }
    if (!isRecord(entries)) {
      addIssue(issues, `${path}.${operator}`, "type", "condition operator must contain an object");
      continue;
    }
    if (Object.keys(entries).length === 0) {
      addIssue(issues, `${path}.${operator}`, "required", "condition operator must not be empty");
    }
    for (const [key, conditionValue] of Object.entries(entries)) {
      conditionKeyCount += 1;
      const conditionPath = `${path}.${operator}.${key}`;
      if (!isPolicyConditionVariable(key)) {
        addIssue(issues, conditionPath, "format", "condition variable is not declared");
      } else if (
        (operator === "Bool" && policyConditionVariableType(key) !== "boolean") ||
        (operator !== "Bool" && policyConditionVariableType(key) !== "string")
      ) {
        addIssue(issues, conditionPath, "type", "condition operator is invalid for this variable");
      }
      validateConditionValue(operator, conditionValue, conditionPath, issues);
    }
  }
  if (conditionKeyCount === 0) addIssue(issues, path, "required", "conditions must not be empty");
  if (conditionKeyCount > POLICY_LIMITS.conditionKeysPerStatement) {
    addIssue(issues, path, "limit", "conditions exceed their limit");
  }
}

export function validatePolicyDocument(
  input: unknown,
  context: PolicyValidationContext = {},
): PolicyValidationResult {
  const issues: PolicyValidationIssue[] = [];
  let encoded: string;
  try {
    encoded = JSON.stringify(input);
  } catch {
    return {
      issues: [{ code: "type", message: "policy must be JSON serializable", path: "$" }],
      ok: false,
    };
  }
  if (new TextEncoder().encode(encoded).byteLength > POLICY_LIMITS.documentBytes) {
    addIssue(issues, "$", "limit", "policy document exceeds its byte limit");
  }
  if (!isRecord(input)) {
    addIssue(issues, "$", "type", "policy document must be an object");
    return { issues, ok: false };
  }
  rejectUnknownKeys(input, documentKeys, "$", issues);
  if (input.version !== POLICY_DOCUMENT_VERSION) {
    addIssue(issues, "$.version", "format", `version must be ${POLICY_DOCUMENT_VERSION}`);
  }
  if (!Array.isArray(input.statements)) {
    addIssue(issues, "$.statements", "type", "statements must be an array");
  } else {
    if (input.statements.length === 0) {
      addIssue(issues, "$.statements", "required", "statements must not be empty");
    }
    if (input.statements.length > POLICY_LIMITS.statements) {
      addIssue(issues, "$.statements", "limit", "statements exceed their limit");
    }
    const seenSids = new Set<string>();
    input.statements.forEach((statement, index) => {
      const path = `$.statements[${index}]`;
      if (!isRecord(statement)) {
        addIssue(issues, path, "type", "statement must be an object");
        return;
      }
      rejectUnknownKeys(statement, statementKeys, path, issues);
      if (statement.effect !== "Allow" && statement.effect !== "Deny") {
        addIssue(issues, `${path}.effect`, "format", "effect must be Allow or Deny");
      }
      if (statement.sid !== undefined) {
        if (
          typeof statement.sid !== "string" ||
          !/^[A-Za-z0-9_-]+$/.test(statement.sid) ||
          statement.sid.length > POLICY_LIMITS.sidLength
        ) {
          addIssue(issues, `${path}.sid`, "format", "sid is invalid");
        } else if (seenSids.has(statement.sid)) {
          addIssue(issues, `${path}.sid`, "duplicate", "sid must be unique");
        } else {
          seenSids.add(statement.sid);
        }
      }
      validateStringArray(
        statement.actions,
        `${path}.actions`,
        POLICY_LIMITS.actionsPerStatement,
        "action",
        context,
        issues,
      );
      validateStringArray(
        statement.resources,
        `${path}.resources`,
        POLICY_LIMITS.resourcesPerStatement,
        "resource",
        context,
        issues,
      );
      if (statement.conditions !== undefined) {
        validateConditions(statement.conditions, `${path}.conditions`, issues);
      }
    });
  }
  return issues.length > 0
    ? { issues, ok: false }
    : { issues: [], ok: true, value: input as unknown as PolicyDocument };
}

export class PolicyValidationError extends Error {
  readonly issues: PolicyValidationIssue[];

  constructor(issues: PolicyValidationIssue[]) {
    super("Policy document is invalid");
    this.name = "PolicyValidationError";
    this.issues = issues;
  }
}

export function parsePolicyDocument(
  input: unknown,
  context: PolicyValidationContext = {},
): PolicyDocument {
  const result = validatePolicyDocument(input, context);
  if (!result.ok) throw new PolicyValidationError(result.issues);
  return result.value;
}
