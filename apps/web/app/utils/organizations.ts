export const ORGANIZATION_ROLES = ["owner", "admin", "member"] as const;
export const MEMBERSHIP_STATUSES = ["active", "suspended"] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export function organizationSlug(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
    .replace(/-$/g, "");
}

export function organizationRoleLabel(role: OrganizationRole) {
  return { admin: "Administrateur", member: "Membre", owner: "Propriétaire" }[role];
}

export function membershipStatusLabel(status: MembershipStatus) {
  return status === "active" ? "Actif" : "Suspendu";
}
