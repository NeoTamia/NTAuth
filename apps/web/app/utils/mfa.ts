export function validTotpCode(value: string) {
  return /^\d{6}$/.test(value);
}

export function totpSecretFromUri(value: string) {
  try {
    const uri = new URL(value);
    if (uri.protocol !== "otpauth:" || uri.hostname !== "totp") return "";
    const secret = uri.searchParams.get("secret") ?? "";
    return /^[A-Z2-7]{16,64}$/.test(secret) ? secret : "";
  } catch {
    return "";
  }
}

export function mfaChallengeHeaders(code: string) {
  return validTotpCode(code) ? { "x-ntauth-totp": code } : {};
}
