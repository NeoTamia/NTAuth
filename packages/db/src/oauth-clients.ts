import { eq } from "drizzle-orm";

import type { NtscoutSeedEnvironment } from "@neotamia/config";
import { NTSCOUT_SCOPES } from "@neotamia/permissions";

import type { DatabaseConnection } from "./client";
import { auditEvents, oauthClients } from "./schema";

export const NTSCOUT_CLIENT_ID = "ntscout";
export { NTSCOUT_SCOPES };

function logoutRedirectUris(redirectUris: readonly string[]) {
  return [...new Set(redirectUris.map((redirectUri) => new URL("/", redirectUri).toString()))];
}

export async function provisionNtscoutClient(
  connection: DatabaseConnection,
  input: NtscoutSeedEnvironment & { requestId: string },
  now = new Date(),
) {
  return connection.db.transaction(async (transaction) => {
    const [client] = await transaction
      .insert(oauthClients)
      .values({
        clientId: NTSCOUT_CLIENT_ID,
        clientSecret: null,
        disabled: false,
        enableEndSession: true,
        grantTypes: ["authorization_code", "refresh_token"],
        id: "managed-client:ntscout",
        metadata: {
          environment: input.NTSCOUT_ENVIRONMENT,
          managedBy: "ntauth-seed",
        },
        name: "NTScout",
        postLogoutRedirectUris: logoutRedirectUris(input.NTSCOUT_REDIRECT_URIS),
        public: true,
        redirectUris: input.NTSCOUT_REDIRECT_URIS,
        requirePKCE: true,
        responseTypes: ["code"],
        scopes: [...NTSCOUT_SCOPES],
        skipConsent: false,
        tokenEndpointAuthMethod: "none",
        type: "user-agent-based",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: oauthClients.clientId,
        set: {
          clientSecret: null,
          disabled: false,
          enableEndSession: true,
          grantTypes: ["authorization_code", "refresh_token"],
          metadata: {
            environment: input.NTSCOUT_ENVIRONMENT,
            managedBy: "ntauth-seed",
          },
          name: "NTScout",
          postLogoutRedirectUris: logoutRedirectUris(input.NTSCOUT_REDIRECT_URIS),
          public: true,
          redirectUris: input.NTSCOUT_REDIRECT_URIS,
          requirePKCE: true,
          responseTypes: ["code"],
          scopes: [...NTSCOUT_SCOPES],
          skipConsent: false,
          tokenEndpointAuthMethod: "none",
          type: "user-agent-based",
          updatedAt: now,
        },
      })
      .returning();
    await transaction.insert(auditEvents).values({
      action: "oauth.client.seed",
      metadata: {
        environment: input.NTSCOUT_ENVIRONMENT,
        redirectUriCount: input.NTSCOUT_REDIRECT_URIS.length,
      },
      outcome: "success",
      requestId: input.requestId,
      resourceId: NTSCOUT_CLIENT_ID,
      resourceType: "oauth_client",
    });
    return client!;
  });
}

export async function getNtscoutClient(connection: DatabaseConnection) {
  const [client] = await connection.db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.clientId, NTSCOUT_CLIENT_ID))
    .limit(1);
  return client;
}
