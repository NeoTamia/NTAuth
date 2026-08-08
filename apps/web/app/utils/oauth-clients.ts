export const OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "ntscout:access",
] as const;

export type OAuthClientKind = "public" | "confidential";

export function normalizeRedirectUris(value: string) {
  const normalized: string[] = [];
  for (const candidate of value.split("\n").map((line) => line.trim())) {
    if (!candidate) continue;
    if (candidate.includes("*")) throw new Error("wildcard_redirect_uri");
    let uri: URL;
    try {
      uri = new URL(candidate);
    } catch {
      throw new Error("invalid_redirect_uri");
    }
    if (!new Set(["http:", "https:"]).has(uri.protocol) || uri.username || uri.password || uri.hash)
      throw new Error("invalid_redirect_uri");
    normalized.push(uri.toString());
  }
  const unique = [...new Set(normalized)];
  if (!unique.length) throw new Error("missing_redirect_uri");
  return unique;
}

export function clientKind(client: {
  public?: boolean;
  token_endpoint_auth_method?: string;
}): OAuthClientKind {
  return client.public || client.token_endpoint_auth_method === "none" ? "public" : "confidential";
}

export function clientPayload(input: {
  kind: OAuthClientKind;
  name: string;
  redirectUris: string;
  scopes: readonly string[];
}) {
  return {
    client_name: input.name.trim(),
    grant_types: ["authorization_code", "refresh_token"],
    redirect_uris: normalizeRedirectUris(input.redirectUris),
    response_types: ["code"],
    scope: input.scopes
      .filter((scope) => OAUTH_SCOPES.includes(scope as (typeof OAUTH_SCOPES)[number]))
      .join(" "),
    token_endpoint_auth_method: input.kind === "public" ? "none" : "client_secret_basic",
    type: input.kind === "public" ? "native" : "web",
  };
}
