import { describe, expect, test } from "bun:test";

import {
  NTAuthProtocolError,
  createAuthorizationRequest,
  openAuthorizationTransaction,
  sealAuthorizationTransaction,
} from "./index";

const secret = "test-only-transaction-secret-with-32-bytes";

describe("OAuth PKCE transaction", () => {
  test("creates S256 state, nonce, verifier, and a local return path", async () => {
    const request = await createAuthorizationRequest({
      authorizationEndpoint: "https://auth.example.test/oauth2/authorize",
      clientId: "ntscout",
      redirectUri: "https://scout.example.test/auth/callback",
      returnTo: "//malicious.example.test",
      scopes: ["openid", "ntscout:access", "openid"],
    });
    const url = new URL(request.authorizationUrl);

    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(request.codeChallenge);
    expect(url.searchParams.get("state")).toBe(request.state);
    expect(url.searchParams.get("nonce")).toBe(request.nonce);
    expect(url.searchParams.get("scope")).toBe("openid ntscout:access");
    expect(request.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(request.returnTo).toBe("/");
  });

  test("seals the transaction and rejects tampering, mismatch, and expiration", async () => {
    const request = await createAuthorizationRequest({
      authorizationEndpoint: "https://auth.example.test/oauth2/authorize",
      clientId: "ntscout",
      redirectUri: "https://scout.example.test/auth/callback",
      returnTo: "/reports",
      scopes: ["openid"],
    });
    const sealed = await sealAuthorizationTransaction(request, secret);

    await expect(
      openAuthorizationTransaction(sealed, secret, { state: request.state }),
    ).resolves.toMatchObject({ returnTo: "/reports", state: request.state });
    const failures = await Promise.all([
      openAuthorizationTransaction(`${sealed}x`, secret, { state: request.state }).catch(
        (error) => error,
      ),
      openAuthorizationTransaction(sealed, secret, { state: "wrong-state" }).catch(
        (error) => error,
      ),
      openAuthorizationTransaction(sealed, secret, {
        now: request.createdAt + 5 * 60 * 1000 + 1,
        state: request.state,
      }).catch((error) => error),
    ]);

    for (const failure of failures) {
      expect(failure).toBeInstanceOf(NTAuthProtocolError);
      expect(failure).toMatchObject({ code: "invalid_transaction" });
    }
  });
});
