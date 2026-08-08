import { computed, readonly, shallowRef } from "vue";

import { NTAuthProtocolError } from "./errors";
import { createHttpNTAuthTransport, type NTAuthTransport } from "./transport";
import type { CallbackParameters, NTAuthSessionSnapshot, SessionStatus } from "./types";

export function parseCallbackParameters(value: string | URL, expectedIssuer?: string) {
  const url = value instanceof URL ? value : new URL(value, "http://localhost");
  const error = url.searchParams.get("error");
  if (error) {
    throw new NTAuthProtocolError(
      "callback_error",
      url.searchParams.get("error_description") ?? "The authorization server refused the request",
    );
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const iss = url.searchParams.get("iss") ?? undefined;
  if (!code || !state || (expectedIssuer && iss !== expectedIssuer)) {
    throw new NTAuthProtocolError("invalid_callback", "The OAuth callback parameters are invalid");
  }
  return { code, iss, state } satisfies CallbackParameters;
}

export function createNTAuthSession(
  options: {
    expectedIssuer?: string;
    transport?: NTAuthTransport;
  } = {},
) {
  const transport = options.transport ?? createHttpNTAuthTransport();
  const snapshot = shallowRef<NTAuthSessionSnapshot | null>(null);
  const status = shallowRef<SessionStatus>("loading");
  const error = shallowRef<NTAuthProtocolError | null>(null);
  let refreshInFlight: Promise<NTAuthSessionSnapshot | null> | undefined;

  function apply(next: NTAuthSessionSnapshot | null) {
    snapshot.value = next;
    status.value = next ? "authenticated" : "anonymous";
    error.value = null;
    return next;
  }

  function fail(caught: unknown): never {
    const protocolError =
      caught instanceof NTAuthProtocolError
        ? caught
        : new NTAuthProtocolError("session_unavailable", "The session operation failed", 503);
    error.value = protocolError;
    status.value = "error";
    throw protocolError;
  }

  async function hydrate() {
    status.value = "loading";
    try {
      return apply(await transport.session());
    } catch (caught) {
      return fail(caught);
    }
  }

  async function login(returnTo = "/") {
    try {
      return (await transport.login(returnTo)).authorizationUrl;
    } catch (caught) {
      return fail(caught);
    }
  }

  async function handleCallback(value: string | URL) {
    status.value = "loading";
    try {
      const parameters = parseCallbackParameters(value, options.expectedIssuer);
      return apply(await transport.callback(parameters));
    } catch (caught) {
      return fail(caught);
    }
  }

  function refresh() {
    if (!refreshInFlight) {
      status.value = "loading";
      refreshInFlight = transport
        .refresh()
        .then(apply)
        .catch(fail)
        .finally(() => {
          refreshInFlight = undefined;
        });
    }
    return refreshInFlight;
  }

  async function logout() {
    try {
      await transport.logout();
      apply(null);
    } catch (caught) {
      apply(null);
      return fail(caught);
    }
  }

  return {
    error: readonly(error),
    handleCallback,
    hydrate,
    identity: computed(() => snapshot.value?.identity ?? null),
    isAuthenticated: computed(() => status.value === "authenticated"),
    login,
    logout,
    refresh,
    session: readonly(snapshot),
    status: readonly(status),
  };
}

export type NTAuthSession = ReturnType<typeof createNTAuthSession>;
