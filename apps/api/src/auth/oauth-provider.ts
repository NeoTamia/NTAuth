import { oauthProvider } from "@better-auth/oauth-provider";

export const oauthProviderConfig = {
  accessTokenExpiresIn: 15 * 60,
  allowDynamicClientRegistration: false,
  allowUnauthenticatedClientRegistration: false,
  codeExpiresIn: 5 * 60,
  consentPage: "/consent",
  disableJwtPlugin: false,
  loginPage: "/sign-in",
  prefix: {
    clientSecret: "ntauth_client_",
    opaqueAccessToken: "ntauth_access_",
    refreshToken: "ntauth_refresh_",
  },
  refreshTokenExpiresIn: 30 * 24 * 60 * 60,
  scopes: ["ntscout:access"],
  storeClientSecret: "hashed" as const,
  storeTokens: "hashed" as const,
};

export const createOAuthProviderPlugin = () => oauthProvider(oauthProviderConfig);
