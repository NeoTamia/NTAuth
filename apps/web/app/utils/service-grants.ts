export const SERVICE_GRANT_STATUSES = ["active", "inactive", "revoked"] as const;

export type ServiceGrantStatus = (typeof SERVICE_GRANT_STATUSES)[number];

export function serviceGrantStatusLabel(status: ServiceGrantStatus) {
  return { active: "Actif", inactive: "Suspendu", revoked: "Révoqué" }[status];
}

export function matchesGrantSearch(query: string, values: Array<string | null | undefined>) {
  const normalized = query.trim().toLocaleLowerCase("fr");
  return !normalized || values.some((value) => value?.toLocaleLowerCase("fr").includes(normalized));
}
