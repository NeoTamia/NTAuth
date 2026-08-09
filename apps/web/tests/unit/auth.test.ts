import { describe, expect, test } from "bun:test";

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  authErrorMessage,
  safeLocalRedirect,
  validPassword,
} from "@/utils/auth";

const page = (name: string) =>
  Bun.file(new URL(`../../app/pages/auth/${name}.vue`, import.meta.url)).text();

describe("account access routes", () => {
  test("accepts only local post-authentication redirects", () => {
    expect(safeLocalRedirect("/admin/users?state=active")).toBe("/admin/users?state=active");
    expect(safeLocalRedirect("https://attacker.test")).toBe("/admin");
    expect(safeLocalRedirect("//attacker.test")).toBe("/admin");
    expect(safeLocalRedirect("/\\attacker.test")).toBe("/admin");
  });

  test("keeps password boundaries aligned with the API", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
    expect(validPassword("short-value")).toBe(false);
    expect(validPassword("long-enough-value")).toBe(true);
    expect(validPassword("x".repeat(129))).toBe(false);
  });

  test("maps only safe actionable authentication errors", () => {
    expect(authErrorMessage({ statusCode: 429 }, "fallback")).toContain("Trop de tentatives");
    expect(authErrorMessage({ data: { code: "invalid_password_reset" } }, "fallback")).toContain(
      "expiré",
    );
    expect(authErrorMessage({ data: { code: "invalid_invitation" } }, "fallback")).toContain(
      "invitation",
    );
    expect(authErrorMessage({ data: { code: "invalid_mfa_challenge" } }, "fallback")).toContain(
      "code",
    );
    expect(authErrorMessage({ data: { title: "database secret" } }, "fallback")).toBe("fallback");
  });

  test("ships labelled login, recovery and reset states", async () => {
    const [signIn, forgot, reset] = await Promise.all([
      page("sign-in"),
      page("forgot-password"),
      page("reset-password"),
    ]);
    expect(signIn).toContain('autocomplete="current-password"');
    expect(signIn).toContain("/api/auth/sign-in/email");
    expect(signIn).toContain('role="alert"');
    expect(forgot).toContain("nous ne confirmerons pas l’existence d’un compte");
    expect(forgot).toContain("/api/v1/password/forgot");
    expect(reset).toContain('autocomplete="new-password"');
    expect(reset).toContain('minlength="12"');
    expect(reset).toContain("/api/v1/password/reset");
    expect(reset).toContain("Demander un nouveau lien");
  });

  test("fails closed with POST when Vue has not hydrated", async () => {
    const pages = await Promise.all([
      page("sign-in"),
      page("forgot-password"),
      page("reset-password"),
      page("accept-invitation"),
    ]);

    for (const source of pages) {
      expect(source).toMatch(/<form\b[\s\S]*?method="post"[\s\S]*?@submit\.prevent=/);
    }
  });

  test("redacts credentials accidentally submitted in an authentication URL", async () => {
    const middleware = await Bun.file(
      new URL("../../server/middleware/redact-auth-query.ts", import.meta.url),
    ).text();

    expect(middleware).toContain('"/auth/sign-in": ["email", "password"]');
    expect(middleware).toContain("url.searchParams.has(key)");
    expect(middleware).toContain("url.searchParams.delete(key)");
    expect(middleware).toContain("sendRedirect");
  });

  test("validates invitation scope before rendering its acceptance form", async () => {
    const invitation = await page("accept-invitation");
    expect(invitation).toContain("/api/v1/invitations/validate");
    expect(invitation).toContain('v-else-if="invitation"');
    expect(invitation).toContain('aria-label="Portée de l’invitation"');
    expect(invitation).toContain("/api/v1/invitations/accept");
    expect(invitation).toContain('autocomplete="new-password"');
    expect(invitation).toContain("Organisation rejointe");
  });
});
