export const OAUTH_SCOPE_CATALOG = {
  openid: {
    claims: ["sub"],
    description: "Bind the authorization to the global NTAuth identity.",
  },
  profile: {
    claims: ["name"],
    description: "Expose the display name of the authenticated identity.",
  },
  email: {
    claims: ["email", "email_verified"],
    description: "Expose the verified email address and its verification state.",
  },
  offline_access: {
    claims: [],
    description: "Allow a refresh-token family after explicit consent.",
  },
  "ntscout:access": {
    claims: ["organization_id", "service", "policies_etag"],
    description: "Allow NTScout access within the organization bound by NTAuth.",
  },
} as const;

export type OAuthScope = keyof typeof OAUTH_SCOPE_CATALOG;

export const OAUTH_SCOPES = Object.freeze(Object.keys(OAUTH_SCOPE_CATALOG) as OAuthScope[]);
export const NTSCOUT_SCOPES = OAUTH_SCOPES;

export const NTAUTH_ACCESS_TOKEN_CLAIMS = Object.freeze([
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
] as const);

export function isOAuthScope(value: string): value is OAuthScope {
  return Object.hasOwn(OAUTH_SCOPE_CATALOG, value);
}

export function filterOAuthScopes(requested: readonly string[], allowed: readonly OAuthScope[]) {
  const allowedScopes = new Set(allowed);
  return requested.filter(
    (scope): scope is OAuthScope => isOAuthScope(scope) && allowedScopes.has(scope),
  );
}
