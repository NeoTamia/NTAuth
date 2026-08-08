import { describe, expect, test } from "bun:test";

import {
  filterOAuthScopes,
  NTAUTH_ACCESS_TOKEN_CLAIMS,
  NTSCOUT_AUDIENCE,
  NTSCOUT_SCOPES,
  NTSCOUT_SERVICE,
  OAUTH_SCOPE_CATALOG,
} from "./oauth";

describe("OAuth scope contract", () => {
  test("keeps the V1 catalogue and minimal access-token claims stable", () => {
    expect(NTSCOUT_SCOPES).toEqual([
      "openid",
      "profile",
      "email",
      "offline_access",
      "ntscout:access",
    ]);
    expect(OAUTH_SCOPE_CATALOG.offline_access.claims).toEqual([]);
    expect(NTSCOUT_AUDIENCE).toBe("urn:neotamia:service:ntscout");
    expect(NTSCOUT_SERVICE).toBe("ntscout");
    expect(NTAUTH_ACCESS_TOKEN_CLAIMS).toEqual([
      "iss",
      "sub",
      "aud",
      "azp",
      "exp",
      "iat",
      "jti",
      "sid",
      "organization_id",
      "service",
      "scope",
      "policies_etag",
    ]);
  });

  test("drops unknown and client-disallowed scopes", () => {
    expect(
      filterOAuthScopes(
        ["openid", "email", "admin", "ntscout:access"],
        ["openid", "ntscout:access"],
      ),
    ).toEqual(["openid", "ntscout:access"]);
  });
});
