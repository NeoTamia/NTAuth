import { evaluatePolicyConditions, type PolicyConditionContext } from "./conditions";
import { isPolicyIdentifier, type PolicyStatement } from "./iam";

export type PolicyDecisionReason = "explicit_allow" | "explicit_deny" | "implicit_deny";

export type PolicyDecision = {
  allowed: boolean;
  matchedAllowStatements: string[];
  matchedDenyStatements: string[];
  reason: PolicyDecisionReason;
};

export type PolicyEvaluationRequest = {
  action: string;
  context: PolicyConditionContext;
  resource: string;
  statements: readonly PolicyStatement[];
};

function concreteIdentifier(value: string, kind: "action" | "resource") {
  return !value.includes("*") && isPolicyIdentifier(value, kind);
}

export function matchesPolicyIdentifier(pattern: string, value: string) {
  if (pattern === value) return true;
  if (!pattern.endsWith(":*")) return false;
  const prefix = pattern.slice(0, -1);
  return value.startsWith(prefix) && value.length > prefix.length;
}

function statementMatches(
  statement: PolicyStatement,
  request: Omit<PolicyEvaluationRequest, "statements">,
) {
  return (
    (statement.effect === "Allow" || statement.effect === "Deny") &&
    Array.isArray(statement.actions) &&
    statement.actions.some((pattern) => matchesPolicyIdentifier(pattern, request.action)) &&
    Array.isArray(statement.resources) &&
    statement.resources.some((pattern) => matchesPolicyIdentifier(pattern, request.resource)) &&
    evaluatePolicyConditions(statement.conditions, request.context)
  );
}

export function evaluatePolicy(request: PolicyEvaluationRequest): PolicyDecision {
  if (
    !concreteIdentifier(request.action, "action") ||
    !concreteIdentifier(request.resource, "resource")
  ) {
    return {
      allowed: false,
      matchedAllowStatements: [],
      matchedDenyStatements: [],
      reason: "implicit_deny",
    };
  }
  const allow: string[] = [];
  const deny: string[] = [];
  request.statements.forEach((statement, index) => {
    if (!statementMatches(statement, request)) return;
    const identifier = statement.sid ?? `statement:${index}`;
    if (statement.effect === "Deny") deny.push(identifier);
    else allow.push(identifier);
  });
  allow.sort();
  deny.sort();
  if (deny.length > 0) {
    return {
      allowed: false,
      matchedAllowStatements: allow,
      matchedDenyStatements: deny,
      reason: "explicit_deny",
    };
  }
  if (allow.length > 0) {
    return {
      allowed: true,
      matchedAllowStatements: allow,
      matchedDenyStatements: [],
      reason: "explicit_allow",
    };
  }
  return {
    allowed: false,
    matchedAllowStatements: [],
    matchedDenyStatements: [],
    reason: "implicit_deny",
  };
}
