import { oauthProvider } from "@better-auth/oauth-provider";
import type { GrantType } from "@better-auth/oauth-provider";
import { and, eq } from "drizzle-orm";

import { currentOAuthOrganization } from "./oauth-organization";

import {
  enforcePlatformAdminMfa,
  platformRoleAssignments,
  type DatabaseConnection,
} from "@neotamia/db";
import { OAUTH_SCOPES } from "@neotamia/permissions";

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
  scopes: [...OAUTH_SCOPES],
  silenceWarnings: { oauthAuthServerConfig: true, openidConfig: true },
  storeClientSecret: "hashed" as const,
  storeTokens: "hashed" as const,
};

export const createOAuthProviderPlugin = (options?: {
  applicationSecret: string;
  database: DatabaseConnection;
}) =>
  oauthProvider({
    ...oauthProviderConfig,
    postLogin: options
      ? {
          consentReferenceId: () => {
            const organizationId = currentOAuthOrganization();
            if (!organizationId) throw new Error("OAuth organization context is required");
            return organizationId;
          },
          page: "/select-organization",
          shouldRedirect: () => false,
        }
      : undefined,
    clientPrivileges: async ({ headers, session }) => {
      if (!options || !session) return false;
      const [administrator] = await options.database.db
        .select({ userId: platformRoleAssignments.userId })
        .from(platformRoleAssignments)
        .where(
          and(
            eq(platformRoleAssignments.userId, session.userId),
            eq(platformRoleAssignments.role, "platform_admin"),
          ),
        )
        .limit(1);
      if (!administrator) return false;
      try {
        await enforcePlatformAdminMfa(options.database, {
          applicationSecret: options.applicationSecret,
          code: headers.get("x-ntauth-totp") ?? undefined,
          requestId: headers.get("x-request-id") ?? crypto.randomUUID(),
          userId: session.userId,
        });
        return true;
      } catch {
        return false;
      }
    },
  });
