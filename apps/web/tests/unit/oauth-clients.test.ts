import { describe, expect, test } from "bun:test";

import {
  clientKind,
  clientPayload,
  normalizeRedirectUris,
  OAUTH_SCOPES,
} from "../../app/utils/oauth-clients";

describe("OAuth client administration", () => {
  test("normalizes exact HTTP(S) redirect URIs and removes duplicates", () => {
    expect(
      normalizeRedirectUris(
        "https://app.example.test/callback\nhttps://app.example.test/callback\nhttp://localhost:3000/callback",
      ),
    ).toEqual(["https://app.example.test/callback", "http://localhost:3000/callback"]);
    expect(() => normalizeRedirectUris("https://*.example.test/callback")).toThrow(
      "wildcard_redirect_uri",
    );
    expect(() => normalizeRedirectUris("https://user:pass@example.test/callback")).toThrow(
      "invalid_redirect_uri",
    );
    expect(() => normalizeRedirectUris("https://example.test/callback#secret")).toThrow(
      "invalid_redirect_uri",
    );
  });

  test("builds explicit public and confidential contracts", () => {
    const shared = {
      name: "NTScout",
      redirectUris: "https://ntscout.example.test/auth/callback",
      scopes: [...OAUTH_SCOPES, "unknown"],
    };
    expect(clientPayload({ ...shared, kind: "public" })).toMatchObject({
      token_endpoint_auth_method: "none",
      type: "native",
    });
    expect(clientPayload({ ...shared, kind: "confidential" })).toMatchObject({
      token_endpoint_auth_method: "client_secret_basic",
      type: "web",
    });
    expect(clientPayload({ ...shared, kind: "public" }).scope).not.toContain("unknown");
    expect(clientKind({ public: true })).toBe("public");
    expect(clientKind({ token_endpoint_auth_method: "client_secret_basic" })).toBe("confidential");
  });

  test("keeps every registry mutation behind a fresh MFA challenge", async () => {
    const page = await Bun.file(
      new URL("../../app/pages/admin/oauth-clients.vue", import.meta.url),
    ).text();
    for (const endpoint of [
      "/api/auth/oauth2/get-clients",
      "/api/auth/oauth2/create-client",
      "/api/auth/oauth2/update-client",
      "/api/auth/oauth2/client/rotate-secret",
      "/api/auth/oauth2/delete-client",
    ])
      expect(page).toContain(endpoint);
    expect(page).toContain("mfaChallengeHeaders");
    expect(page).toContain("createdSecret");
    expect(page).toContain("rotatedSecret");
    expect(page).toContain("confirmDelete");
    expect(page).toContain("scrollIntoView");
    expect(page).toContain('role="alert"');
  });
});
