import { describe, expect, test } from "bun:test";

import {
  NTAuthProtocolError,
  createHttpNTAuthTransport,
  createNTAuthMiddleware,
  createNTAuthSession,
  parseCallbackParameters,
  type NTAuthSessionSnapshot,
  type NTAuthTransport,
} from "./index";

const snapshot: NTAuthSessionSnapshot = {
  expiresAt: "2026-08-08T21:00:00.000Z",
  identity: { id: "user-id", name: "Ada" },
  organizationId: "organization-id",
  scopes: ["openid", "ntscout:access"],
  service: "ntscout",
};

function transport(overrides: Partial<NTAuthTransport> = {}): NTAuthTransport {
  return {
    callback: async () => snapshot,
    login: async () => ({ authorizationUrl: "https://auth.example.test/authorize" }),
    logout: async () => {},
    refresh: async () => snapshot,
    session: async () => null,
    ...overrides,
  };
}

describe("Nuxt authentication session", () => {
  test("is SSR-safe and exposes an authenticated reactive snapshot", async () => {
    const auth = createNTAuthSession({ transport: transport({ session: async () => snapshot }) });
    await auth.hydrate();

    expect(auth.status.value).toBe("authenticated");
    expect(auth.isAuthenticated.value).toBe(true);
    expect(auth.identity.value).toEqual({ id: "user-id", name: "Ada" });
    expect(auth.session.value).toEqual(snapshot);
  });

  test("serializes concurrent refreshes into one transport request", async () => {
    let calls = 0;
    let release: ((value: NTAuthSessionSnapshot) => void) | undefined;
    const pending = new Promise<NTAuthSessionSnapshot>((resolve) => {
      release = resolve;
    });
    const auth = createNTAuthSession({
      transport: transport({
        refresh: () => {
          calls += 1;
          return pending;
        },
      }),
    });
    const first = auth.refresh();
    const second = auth.refresh();
    release?.(snapshot);

    expect(first).toBe(second);
    await expect(first).resolves.toEqual(snapshot);
    expect(calls).toBe(1);
  });

  test("validates callback errors and issuer before calling the BFF", async () => {
    expect(() =>
      parseCallbackParameters(
        "https://app.test/callback?code=code&state=state&iss=https%3A%2F%2Fwrong.test",
        "https://auth.example.test",
      ),
    ).toThrow(NTAuthProtocolError);
    expect(() => parseCallbackParameters("https://app.test/callback?error=access_denied")).toThrow(
      "authorization server refused",
    );
  });

  test("protects route redirects and clears the local session on logout", async () => {
    const destinations: string[] = [];
    const auth = createNTAuthSession({ transport: transport() });
    const middleware = createNTAuthMiddleware(auth, (location) => destinations.push(location));
    await middleware({ fullPath: "//malicious.example.test" });
    expect(destinations).toEqual(["/auth/sign-in?redirect=%2F"]);

    const authenticated = createNTAuthSession({
      transport: transport({ session: async () => snapshot }),
    });
    await authenticated.hydrate();
    await authenticated.logout();
    expect(authenticated.session.value).toBeNull();
    expect(authenticated.status.value).toBe("anonymous");
  });

  test("keeps credentials in same-origin BFF requests and never returns tokens", async () => {
    const calls: Array<{ init?: RequestInit; url: string }> = [];
    const http = createHttpNTAuthTransport({
      baseUrl: "/api/ntauth",
      fetch: async (input, init) => {
        calls.push({ init, url: input.toString() });
        return Response.json(snapshot);
      },
    });
    await http.session();
    await http.refresh();

    expect(calls.map(({ init }) => init?.credentials)).toEqual(["include", "include"]);
    expect(JSON.stringify(await http.session())).not.toMatch(/access_token|refresh_token/i);
  });
});
