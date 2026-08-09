import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

import { ntauth } from "../../src/index";

describe("Elysia NTAuth plugin", () => {
  test("injects a typed request context and serializes OAuth bearer errors", async () => {
    const issuer = "https://auth.example.test";
    const audience = "urn:neotamia:service:ntscout";
    const pair = await generateKeyPair("ES256");
    const publicKey = await exportJWK(pair.publicKey);
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      azp: "ntscout",
      organization_id: "00000000-0000-4000-8000-000000000001",
      policies_etag: "a".repeat(43),
      scope: "ntscout:access",
      service: "ntscout",
      sid: "session-id",
    })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject("user-id")
      .setJti("00000000-0000-4000-8000-000000000002")
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(pair.privateKey);
    const app = new Elysia()
      .use(
        ntauth({
          audience,
          fetch: async () =>
            Response.json(
              {
                etag: `"${"b".repeat(64)}"`,
                organizationId: "00000000-0000-4000-8000-000000000001",
                service: "ntscout",
                statements: [],
                subjectUserId: "user-id",
              },
              { headers: { etag: `"${"b".repeat(64)}"` } },
            ),
          issuer,
          jwks: { keys: [{ ...publicKey, alg: "ES256", kid: "test-key", use: "sig" }] },
          service: "ntscout",
        }),
      )
      .get("/identity", ({ auth }) => auth.identity);

    const authenticated = await app.handle(
      new Request("http://localhost/identity", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const anonymous = await app.handle(new Request("http://localhost/identity"));

    expect(authenticated.status).toBe(200);
    expect(await authenticated.json()).toEqual({ id: "user-id" });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("www-authenticate")).toBe(
      'Bearer error="authentication_required"',
    );
  });
});
