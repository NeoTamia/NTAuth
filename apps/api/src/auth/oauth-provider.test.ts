import { describe, expect, it } from "bun:test";
import { oidcProvider } from "better-auth/plugins";
import { createOAuthProviderPlugin, oauthProviderConfig } from "./oauth-provider";

describe("Better Auth provider decision", () => {
  it("exposes the OAuth 2.1 endpoints required by NTAuth", () => {
    const plugin = createOAuthProviderPlugin();
    const endpoints = Object.keys(plugin.endpoints);

    expect(plugin.id).toBe("oauth-provider");
    expect(endpoints).toContain("oauth2Token");
    expect(endpoints).toContain("oauth2Introspect");
    expect(endpoints).toContain("oauth2Revoke");
    expect(endpoints).toContain("oauth2UserInfo");
    expect(endpoints).toContain("oauth2EndSession");
  });

  it("pins the security-sensitive defaults selected for NTAuth", () => {
    expect(oauthProviderConfig).toMatchObject({
      accessTokenExpiresIn: 900,
      allowDynamicClientRegistration: false,
      allowUnauthenticatedClientRegistration: false,
      codeExpiresIn: 300,
      disableJwtPlugin: false,
      refreshTokenExpiresIn: 2_592_000,
      storeClientSecret: "hashed",
      storeTokens: "hashed",
    });
  });

  it("demonstrates the missing protocol endpoints in the deprecated plugin", () => {
    const legacyPlugin = oidcProvider({
      consentPage: "/consent",
      loginPage: "/sign-in",
    });
    const legacyEndpoints = Object.keys(legacyPlugin.endpoints);

    expect(legacyPlugin.id).toBe("oidc-provider");
    expect(legacyEndpoints).not.toContain("oauth2Introspect");
    expect(legacyEndpoints).not.toContain("oauth2Revoke");
  });
});
