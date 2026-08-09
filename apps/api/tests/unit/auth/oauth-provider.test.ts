import { describe, expect, it } from "bun:test";
import { oidcProvider } from "better-auth/plugins";

import { NTSCOUT_AUDIENCE } from "@neotamia/permissions";

import { createOAuthProviderPlugin, oauthProviderConfig } from "@/auth/oauth-provider";

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
      grantTypes: ["authorization_code", "refresh_token"],
      idTokenExpiresIn: 900,
      refreshTokenExpiresIn: 2_592_000,
      scopes: ["openid", "profile", "email", "offline_access", "ntscout:access"],
      storeClientSecret: "hashed",
      storeTokens: "hashed",
      validAudiences: [NTSCOUT_AUDIENCE],
    });
    expect(oauthProviderConfig.grantTypes).not.toContain("client_credentials");
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
