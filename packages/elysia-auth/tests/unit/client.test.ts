import { beforeAll, describe, expect, test } from "bun:test";
import { exportJWK, generateKeyPair, SignJWT, type JSONWebKeySet } from "jose";

import { NTAuthError, createNTAuthClient } from "../../src/index";

const issuer = "https://auth.example.test";
const audience = "urn:neotamia:service:ntscout";
const organizationId = "00000000-0000-4000-8000-000000000001";
const tokenEtag = "a".repeat(43);
const policyEtag = `"${"b".repeat(64)}"`;
let privateKey: CryptoKey;
let jwks: JSONWebKeySet;

beforeAll(async () => {
  const pair = await generateKeyPair("ES256");
  privateKey = pair.privateKey;
  const publicKey = await exportJWK(pair.publicKey);
  jwks = { keys: [{ ...publicKey, alg: "ES256", kid: "test-key", use: "sig" }] };
});

async function accessToken(
  options: {
    audience?: string;
    claims?: Record<string, unknown>;
    expiration?: number;
  } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    azp: "ntscout",
    iat: now,
    jti: "00000000-0000-4000-8000-000000000002",
    organization_id: organizationId,
    policies_etag: tokenEtag,
    scope: "openid ntscout:access",
    service: "ntscout",
    sid: "session-id",
    ...options.claims,
  })
    .setProtectedHeader({ alg: "ES256", kid: "test-key" })
    .setIssuer(issuer)
    .setAudience(options.audience ?? audience)
    .setSubject("user-id")
    .setExpirationTime(options.expiration ?? now + 300)
    .sign(privateKey);
}

function effectivePolicies() {
  return {
    etag: policyEtag,
    organizationId,
    service: "ntscout",
    statements: [
      {
        actions: ["ntscout:report:read"],
        effect: "Allow" as const,
        resources: ["ntscout:report:*"],
        sid: "read-reports",
      },
    ],
    subjectUserId: "user-id",
  };
}

function request(token?: string) {
  return new Request("https://service.example.test/reports", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe("NTAuth Elysia client", () => {
  test("verifies ES256 claims, injects identity, and evaluates deny-first policies", async () => {
    const seenIfNoneMatch: Array<string | null> = [];
    const fetcher = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seenIfNoneMatch.push(headers.get("if-none-match"));
      if (headers.get("if-none-match") === policyEtag) {
        return new Response(null, { headers: { etag: policyEtag }, status: 304 });
      }
      return Response.json(effectivePolicies(), { headers: { etag: policyEtag } });
    };
    const client = createNTAuthClient({
      audience,
      fetch: fetcher,
      issuer,
      jwks,
      requiredScopes: ["openid", "ntscout:access"],
      service: "ntscout",
    });
    const token = await accessToken();
    const first = await client.authenticate(request(token));
    const second = await client.authenticate(request(token));

    expect(first.identity.id).toBe("user-id");
    expect(first.organizationId).toBe(organizationId);
    expect(first.scopes).toEqual(["openid", "ntscout:access"]);
    expect(
      first.authorize({ action: "ntscout:report:read", resource: "ntscout:report:quarterly" }),
    ).toMatchObject({ allowed: true, reason: "explicit_allow" });
    expect(second.policies).toEqual(first.policies);
    expect(seenIfNoneMatch).toEqual([null, policyEtag]);
  });

  test("rejects missing, expired, wrong-audience, and malformed tokens as 401", async () => {
    const client = createNTAuthClient({
      audience,
      fetch: async () => Response.json(effectivePolicies(), { headers: { etag: policyEtag } }),
      issuer,
      jwks,
      requiredScopes: ["ntscout:access"],
      service: "ntscout",
    });
    const now = Math.floor(Date.now() / 1000);
    const cases = [
      request(),
      request(await accessToken({ expiration: now - 1 })),
      request(await accessToken({ audience: "wrong-audience" })),
      request("not-a-jwt"),
    ];

    const errors = await Promise.all(
      cases.map((candidate) => client.authenticate(candidate).catch((error) => error)),
    );
    for (const error of errors) {
      expect(error).toMatchObject({ status: 401 });
    }
  });

  test("maps grant revocation to 403 and supports explicit cache invalidation", async () => {
    let revoked = false;
    const seenIfNoneMatch: Array<string | null> = [];
    const client = createNTAuthClient({
      audience,
      fetch: async (_input, init) => {
        const conditional = new Headers(init?.headers).get("if-none-match");
        seenIfNoneMatch.push(conditional);
        if (revoked) return new Response(null, { status: 403 });
        if (conditional) return new Response(null, { status: 304 });
        return Response.json(effectivePolicies(), { headers: { etag: policyEtag } });
      },
      issuer,
      jwks,
      service: "ntscout",
    });
    const token = await accessToken();
    await client.authenticate(request(token));
    client.invalidate({ organizationId, service: "ntscout", subjectUserId: "user-id" });
    await client.authenticate(request(token));
    revoked = true;
    const error = await client.authenticate(request(token)).catch((caught) => caught);

    expect(seenIfNoneMatch).toEqual([null, null, policyEtag]);
    expect(error).toBeInstanceOf(NTAuthError);
    expect(error).toMatchObject({ code: "insufficient_scope", status: 403 });
    expect((error as NTAuthError).toResponse().headers.get("www-authenticate")).toBe(
      'Bearer error="insufficient_scope"',
    );
  });

  test("maps a missing required scope to an OAuth 403 response", async () => {
    const client = createNTAuthClient({
      audience,
      fetch: async () => Response.json(effectivePolicies(), { headers: { etag: policyEtag } }),
      issuer,
      jwks,
      requiredScopes: ["ntscout:admin"],
      service: "ntscout",
    });
    const error = await client.authenticate(request(await accessToken())).catch((caught) => caught);

    expect(error).toMatchObject({ code: "insufficient_scope", status: 403 });
    expect((error as NTAuthError).toResponse().headers.get("www-authenticate")).toBe(
      'Bearer error="insufficient_scope"',
    );
  });
});
