import { oauthProvider } from "@better-auth/oauth-provider";
import type { GrantType } from "@better-auth/oauth-provider";

export const oauthProviderConfig = {
  accessTokenExpiresIn: 15 * 60,
  allowDynamicClientRegistration: false,
  allowPublicClientPrelogin: false,
  allowUnauthenticatedClientRegistration: false,
  codeExpiresIn: 5 * 60,
  consentPage: "/consent",
  disableJwtPlugin: false,
  grantTypes: ["authorization_code", "refresh_token"] as GrantType[],
  idTokenExpiresIn: 15 * 60,
  loginPage: "/sign-in",
  prefix: {
    clientSecret: "ntauth_client_",
    opaqueAccessToken: "ntauth_access_",
    refreshToken: "ntauth_refresh_",
  },
  refreshTokenExpiresIn: 30 * 24 * 60 * 60,
  scopes: ["openid", "profile", "email", "offline_access", "ntscout:access"],
  storeClientSecret: "hashed" as const,
  storeTokens: "hashed" as const,
};

export const createOAuthProviderPlugin = () => oauthProvider(oauthProviderConfig);
