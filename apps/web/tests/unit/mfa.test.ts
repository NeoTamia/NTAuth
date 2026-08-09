import { describe, expect, test } from "bun:test";

import { mfaChallengeHeaders, totpSecretFromUri, validTotpCode } from "@/utils/mfa";

describe("MFA administration flow", () => {
  test("accepts only complete numeric TOTP challenges", () => {
    expect(validTotpCode("123456")).toBe(true);
    expect(validTotpCode("12345")).toBe(false);
    expect(validTotpCode("12345a")).toBe(false);
    expect(mfaChallengeHeaders("123456")).toEqual({ "x-ntauth-totp": "123456" });
    expect(mfaChallengeHeaders("invalid")).toEqual({});
  });

  test("extracts secrets only from valid TOTP enrollment URIs", () => {
    const secret = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    expect(totpSecretFromUri(`otpauth://totp/NTAuth:user@example.test?secret=${secret}`)).toBe(
      secret,
    );
    expect(totpSecretFromUri(`https://example.test/?secret=${secret}`)).toBe("");
    expect(totpSecretFromUri("not-a-uri")).toBe("");
  });

  test("keeps the QR and secret scoped to the enrollment state", async () => {
    const [page, codeField] = await Promise.all([
      Bun.file(new URL("../../app/pages/admin/security/mfa.vue", import.meta.url)).text(),
      Bun.file(new URL("../../app/components/MfaCodeField.vue", import.meta.url)).text(),
    ]);
    expect(page).toContain('v-else-if="totpURI"');
    expect(page).toContain('v-if="qrDataURL"');
    expect(page).toContain('totpURI.value = ""');
    expect(codeField).toContain('autocomplete="one-time-code"');
    expect(page).toContain("/api/v1/mfa/status");
    expect(page).toContain("/api/v1/mfa/enroll");
    expect(page).toContain("/api/v1/mfa/verify");
  });
});
