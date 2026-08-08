import {
  POLICY_DOCUMENT_VERSION,
  validatePolicyDocument,
  type PolicyDocument,
  type PolicyStatement,
  type PolicyValidationContext,
  type PolicyValidationIssue,
} from "@neotamia/permissions";

export type PolicyEditorIssue = Pick<PolicyValidationIssue, "code" | "path"> & { message: string };

export const emptyPolicyDocument = (): PolicyDocument => ({
  statements: [{ actions: [], effect: "Allow", resources: [] }],
  version: POLICY_DOCUMENT_VERSION,
});

const issueMessages: Record<PolicyValidationIssue["code"], string> = {
  catalogue: "Cet identifiant n’existe pas dans le catalogue actif.",
  duplicate: "Cette valeur est présente plusieurs fois.",
  format: "Le format de cette valeur est invalide.",
  limit: "La limite autorisée est dépassée.",
  required: "Cette valeur est obligatoire.",
  scope: "Cet identifiant appartient à un autre service.",
  type: "Le type de cette valeur est invalide.",
  unknown: "Ce champ n’est pas pris en charge.",
};

export function validateEditablePolicy(
  document: unknown,
  context: PolicyValidationContext,
): { document?: PolicyDocument; issues: PolicyEditorIssue[] } {
  const result = validatePolicyDocument(document, context);
  if (result.ok) return { document: result.value, issues: [] };
  return {
    issues: result.issues.map(({ code, path }) => ({ code, message: issueMessages[code], path })),
  };
}

export function parsePolicyJson(source: string, context: PolicyValidationContext) {
  try {
    return validateEditablePolicy(JSON.parse(source), context);
  } catch {
    return {
      issues: [
        { code: "format" as const, message: "Le document n’est pas un JSON valide.", path: "$" },
      ],
    };
  }
}

export function policyJson(document: PolicyDocument) {
  return JSON.stringify(document, null, 2);
}

export function identifierLines(value: string) {
  return [
    ...new Set(
      value
        .split(/\r?\n/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

function statementIdentifiers(statements: PolicyStatement[], key: "actions" | "resources") {
  return new Set(statements.flatMap((statement) => statement[key]));
}

export function policyDiff(previous: PolicyDocument | undefined, next: PolicyDocument) {
  if (!previous) return ["Nouvelle policy : première version à créer."];
  const changes: string[] = [];
  if (previous.statements.length !== next.statements.length) {
    changes.push(
      `${next.statements.length - previous.statements.length > 0 ? "+" : ""}${next.statements.length - previous.statements.length} déclaration(s).`,
    );
  }
  const previousEffects = previous.statements.map(({ effect }) => effect).join(",");
  const nextEffects = next.statements.map(({ effect }) => effect).join(",");
  if (previousEffects !== nextEffects) changes.push("Effets Allow/Deny modifiés.");
  for (const [key, label] of [
    ["actions", "action(s)"],
    ["resources", "ressource(s)"],
  ] as const) {
    const before = statementIdentifiers(previous.statements, key);
    const after = statementIdentifiers(next.statements, key);
    const added = [...after].filter((entry) => !before.has(entry)).length;
    const removed = [...before].filter((entry) => !after.has(entry)).length;
    if (added || removed) changes.push(`+${added} / −${removed} ${label}.`);
  }
  if (policyJson(previous) !== policyJson(next) && !changes.length) {
    changes.push("Conditions ou identifiants de déclaration modifiés.");
  }
  return changes.length ? changes : ["Aucune différence avec la version courante."];
}
