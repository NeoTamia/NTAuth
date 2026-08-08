export const USER_STATUSES = ["active", "suspended", "deactivated", "deleted"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
export type ReversibleUserStatus = Exclude<UserStatus, "deleted">;

export function userStatusLabel(status: UserStatus) {
  return {
    active: "Actif",
    deactivated: "Désactivé",
    deleted: "Supprimé",
    suspended: "Suspendu",
  }[status];
}

export function sessionState(expiresAt: string, now = new Date()) {
  return new Date(expiresAt) > now ? "active" : "expired";
}

export function sessionStateLabel(expiresAt: string, now = new Date()) {
  return sessionState(expiresAt, now) === "active" ? "Active" : "Expirée";
}
