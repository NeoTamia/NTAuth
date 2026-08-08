export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export function safeLocalRedirect(value: unknown, fallback = "/admin") {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return fallback;
  }
  return value;
}

export function validPassword(value: string) {
  return value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_LENGTH;
}

export function authErrorMessage(error: unknown, fallback: string) {
  const candidate = error as {
    data?: { code?: unknown; title?: unknown };
    status?: unknown;
    statusCode?: unknown;
  };
  if (candidate.status === 429 || candidate.statusCode === 429)
    return "Trop de tentatives. Patientez avant de réessayer.";
  if (candidate.data?.code === "invalid_password_reset")
    return "Ce lien est expiré ou a déjà été utilisé. Demandez un nouveau lien.";
  if (candidate.data?.code === "invalid_invitation")
    return "Ce lien d’invitation a expiré, a déjà été utilisé ou a été annulé.";
  if (candidate.data?.code === "invalid_current_password")
    return "Le mot de passe actuel est incorrect.";
  if (candidate.data?.code === "invalid_mfa_challenge")
    return "Ce code est invalide, expiré ou déjà utilisé.";
  if (candidate.data?.code === "mfa_enrollment_required")
    return "Configurez l’authentification à deux facteurs avant cette action.";
  if (candidate.data?.code === "forbidden")
    return "Vous n’êtes pas autorisé à effectuer cette action.";
  return fallback;
}
