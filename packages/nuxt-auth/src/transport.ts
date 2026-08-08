import { NTAuthProtocolError } from "./errors";
import type { CallbackParameters, NTAuthSessionSnapshot } from "./types";

export interface NTAuthTransport {
  callback(parameters: CallbackParameters): Promise<NTAuthSessionSnapshot>;
  login(returnTo: string): Promise<{ authorizationUrl: string }>;
  logout(): Promise<void>;
  refresh(): Promise<NTAuthSessionSnapshot | null>;
  session(): Promise<NTAuthSessionSnapshot | null>;
}

export type NTAuthFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function localReturnPath(value: string) {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

async function responseBody<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new NTAuthProtocolError(
      "session_unavailable",
      response.status === 401
        ? "The session is not authenticated"
        : "The authentication service is unavailable",
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

export function createHttpNTAuthTransport(
  options: {
    baseUrl?: string;
    fetch?: NTAuthFetch;
  } = {},
): NTAuthTransport {
  const baseUrl = options.baseUrl ?? "/api/ntauth";
  const fetcher: NTAuthFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const call = (path: string, init?: RequestInit) =>
    fetcher(`${baseUrl}${path}`, { credentials: "include", ...init });
  return {
    async callback(parameters) {
      const response = await call("/callback", {
        body: JSON.stringify(parameters),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      return responseBody<NTAuthSessionSnapshot>(response);
    },
    async login(returnTo) {
      const response = await call(
        `/login?returnTo=${encodeURIComponent(localReturnPath(returnTo))}`,
      );
      return responseBody<{ authorizationUrl: string }>(response);
    },
    async logout() {
      const response = await call("/logout", { method: "POST" });
      if (!response.ok && response.status !== 401) await responseBody(response);
    },
    async refresh() {
      const response = await call("/refresh", { method: "POST" });
      if (response.status === 401) return null;
      return responseBody<NTAuthSessionSnapshot>(response);
    },
    async session() {
      const response = await call("/session");
      if (response.status === 401) return null;
      return responseBody<NTAuthSessionSnapshot>(response);
    },
  };
}
