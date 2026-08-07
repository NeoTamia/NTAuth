import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import { Elysia } from "elysia";

import type { createAuth } from "./auth";
import { withPublicMetadataCache } from "./public-cache";

type Auth = ReturnType<typeof createAuth>;

export function createDiscoveryRoutes(auth: Auth) {
  const authorizationServer = oauthProviderAuthServerMetadata(auth);
  const openId = oauthProviderOpenIdConfigMetadata(auth);
  return new Elysia()
    .get("/.well-known/oauth-authorization-server/api/auth", ({ request }) =>
      authorizationServer(request).then((response) => withPublicMetadataCache(request, response)),
    )
    .get("/.well-known/openid-configuration", ({ request }) =>
      openId(request).then((response) => withPublicMetadataCache(request, response)),
    );
}
