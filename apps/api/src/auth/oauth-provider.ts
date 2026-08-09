import { oauthProvider } from "@better-auth/oauth-provider";
import type { GrantType } from "@better-auth/oauth-provider";
import { APIError } from "better-auth";
import { and, eq } from "drizzle-orm";

import { currentOAuthOrganization } from "./oauth-organization";

import {
  enforcePlatformAdminMfa,
  hasActiveServiceGrant,
  organizationMembers,
  platformRoleAssignments,
  type DatabaseConnection,
} from "@neotamia/db";
import { NTSCOUT_AUDIENCE, NTSCOUT_SERVICE, OAUTH_SCOPES } from "@neotamia/permissions";

async function policiesEtag(input: {
  organizationId: string;
  role: string;
  updatedAt: Date;
  userId: string;
}) {
  const snapshot = JSON.stringify({
    organizationId: input.organizationId,
    role: input.role,
    service: NTSCOUT_SERVICE,
    updatedAt: input.updatedAt.toISOString(),
    userId: input.userId,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshot));
  return Buffer.from(digest).toString("base64url");
}

async function ntscoutAccessTokenClaims(
  database: DatabaseConnection,
  info: {
    referenceId?: string;
    resource?: string;
    scopes: readonly string[];
    user?: { id: string } | null;
  },
) {
  if (
    info.resource !== NTSCOUT_AUDIENCE ||
    !info.referenceId ||
    !info.user ||
    !info.scopes.includes("ntscout:access")
  ) {
    throw new APIError("BAD_REQUEST", {
      error: "invalid_request",
      error_description: "access token context is invalid",
    });
  }
  const [membership] = await database.db
    .select({ role: organizationMembers.role, updatedAt: organizationMembers.updatedAt })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, info.referenceId),
        eq(organizationMembers.userId, info.user.id),
        eq(organizationMembers.status, "active"),
      ),
    )
    .limit(1);
  if (!membership) {
    throw new APIError("BAD_REQUEST", {
      error: "invalid_request",
      error_description: "access token context is invalid",
    });
  }
  if (
    !(await hasActiveServiceGrant(database, {
      organizationId: info.referenceId,
      service: NTSCOUT_SERVICE,
      userId: info.user.id,
    }))
  ) {
    throw new APIError("BAD_REQUEST", {
      error: "invalid_request",
      error_description: "access token context is invalid",
    });
  }
  return {
    jti: crypto.randomUUID(),
    organization_id: info.referenceId,
    policies_etag: await policiesEtag({
      organizationId: info.referenceId,
      role: membership.role,
      updatedAt: membership.updatedAt,
      userId: info.user.id,
    }),
    service: NTSCOUT_SERVICE,
  };
}

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
  validAudiences: [NTSCOUT_AUDIENCE],
};

export const createOAuthProviderPlugin = (options?: {
  applicationSecret: string;
  database: DatabaseConnection;
}) =>
  oauthProvider({
    ...oauthProviderConfig,
    customAccessTokenClaims: options
      ? (info) => ntscoutAccessTokenClaims(options.database, info)
      : undefined,
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
          sessionId: session.id,
          userId: session.userId,
        });
        return true;
      } catch {
        return false;
      }
    },
  });
