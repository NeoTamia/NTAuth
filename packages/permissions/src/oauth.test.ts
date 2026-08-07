import { describe, expect, test } from "bun:test";

import {
  filterOAuthScopes,
  NTAUTH_ACCESS_TOKEN_CLAIMS,
  NTSCOUT_SCOPES,
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
    expect(NTAUTH_ACCESS_TOKEN_CLAIMS).toEqual([
      "iss",
      "sub",
      "aud",
      "exp",
      "iat",
      "jti",
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
