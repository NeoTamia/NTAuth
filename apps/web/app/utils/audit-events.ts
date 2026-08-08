export type AuditOutcome = "denied" | "success";

export function auditOutcomeLabel(outcome: AuditOutcome) {
  return outcome === "success" ? "Autorisé" : "Refusé";
}

export function auditActionLabel(action: string) {
  return action
    .replace(/^iam\./, "IAM · ")
    .replace(/^service-grant\./, "Grant · ")
    .replaceAll(".", " › ");
}

export function exclusiveDayAfter(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}
