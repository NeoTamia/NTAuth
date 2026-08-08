import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from "jose";

import {
  evaluatePolicy,
  POLICY_DOCUMENT_VERSION,
  parsePolicyDocument,
} from "@neotamia/permissions";

import { NTAuthError } from "./errors";
import type {
  AuthorizationRequest,
  EffectivePolicies,
  NTAuthAccessTokenClaims,
  NTAuthRequestContext,
} from "./types";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const policyEtagPattern = /^"[0-9a-f]{64}"$/;
const tokenEtagPattern = /^[A-Za-z0-9_-]{43}$/;

export interface NTAuthClientOptions {
  audience: string;
  fetch?: NTAuthFetch;
  issuer: string;
  jwks?: JSONWebKeySet;
  jwksUri?: string;
  requiredScopes?: readonly string[];
  service: string;
}

export type NTAuthFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type CachedPolicies = { etag: string; value: EffectivePolicies };

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    throw new NTAuthError(401, "authentication_required", "A bearer access token is required");
  }
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match?.[1]) throw new NTAuthError(401, "invalid_token", "The bearer token is malformed");
  return match[1];
}

function strictClaims(payload: unknown, options: NTAuthClientOptions): NTAuthAccessTokenClaims {
  if (!payload || typeof payload !== "object") {
    throw new NTAuthError(401, "invalid_token", "The access token claims are invalid");
  }
  const claims = payload as Partial<NTAuthAccessTokenClaims>;
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const scopes = typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : [];
  if (
    claims.iss !== options.issuer ||
    !audience.includes(options.audience) ||
    typeof claims.sub !== "string" ||
    typeof claims.azp !== "string" ||
    typeof claims.exp !== "number" ||
    typeof claims.iat !== "number" ||
    typeof claims.jti !== "string" ||
    !uuidPattern.test(claims.jti) ||
    typeof claims.sid !== "string" ||
    typeof claims.organization_id !== "string" ||
    !uuidPattern.test(claims.organization_id) ||
    claims.service !== options.service ||
    typeof claims.scope !== "string" ||
    typeof claims.policies_etag !== "string" ||
    !tokenEtagPattern.test(claims.policies_etag)
  ) {
    throw new NTAuthError(401, "invalid_token", "The access token claims are invalid");
  }
  if (!(options.requiredScopes ?? []).every((scope) => scopes.includes(scope))) {
    throw new NTAuthError(403, "insufficient_scope", "The access token scope is insufficient");
  }
  return claims as NTAuthAccessTokenClaims;
}

function parsePolicies(input: unknown, claims: NTAuthAccessTokenClaims, etagHeader: string | null) {
  if (!input || typeof input !== "object") {
    throw new NTAuthError(503, "policy_unavailable", "The effective policy response is invalid");
  }
  const candidate = input as Partial<EffectivePolicies>;
  const etag = etagHeader ?? candidate.etag;
  if (
    typeof etag !== "string" ||
    !policyEtagPattern.test(etag) ||
    candidate.etag !== etag ||
    candidate.organizationId !== claims.organization_id ||
    candidate.service !== claims.service ||
    candidate.subjectUserId !== claims.sub
  ) {
    throw new NTAuthError(503, "policy_unavailable", "The effective policy scope is invalid");
  }
  if (!Array.isArray(candidate.statements)) {
    throw new NTAuthError(503, "policy_unavailable", "The effective policy response is invalid");
  }
  let statements = candidate.statements;
  try {
    if (statements.length > 0) {
      statements = parsePolicyDocument(
        { statements, version: POLICY_DOCUMENT_VERSION },
        { expectedService: claims.service },
      ).statements;
    }
  } catch {
    throw new NTAuthError(503, "policy_unavailable", "The effective policy response is invalid");
  }
  return { ...candidate, etag, statements } as EffectivePolicies;
}

function cacheKey(claims: NTAuthAccessTokenClaims) {
  return `${claims.sub}:${claims.organization_id}:${claims.service}`;
}

export function createNTAuthClient(options: NTAuthClientOptions) {
  const issuer = options.issuer.replace(/\/$/, "");
  const normalizedOptions = { ...options, issuer };
  const keySet: JWTVerifyGetKey = options.jwks
    ? createLocalJWKSet(options.jwks)
    : createRemoteJWKSet(new URL(options.jwksUri ?? `${issuer}/api/auth/jwks`));
  const fetcher: NTAuthFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const cache = new Map<string, CachedPolicies>();

  async function verify(token: string) {
    try {
      const { payload } = await jwtVerify(token, keySet, {
        algorithms: ["ES256"],
        audience: options.audience,
        issuer,
      });
      return strictClaims(payload, normalizedOptions);
    } catch (error) {
      if (error instanceof NTAuthError) throw error;
      throw new NTAuthError(401, "invalid_token", "The access token is invalid or expired");
    }
  }

  async function loadPolicies(token: string, claims: NTAuthAccessTokenClaims) {
    const key = cacheKey(claims);
    const cached = cache.get(key);
    const url = new URL("/api/v1/iam/effective-policies", `${issuer}/`);
    url.searchParams.set("organization_id", claims.organization_id);
    url.searchParams.set("service", claims.service);
    const headers = new Headers({ authorization: `Bearer ${token}` });
    if (cached) headers.set("if-none-match", cached.etag);
    let response: Response;
    try {
      response = await fetcher(url, { headers });
    } catch {
      throw new NTAuthError(503, "policy_unavailable", "Effective policies are unavailable");
    }
    if (response.status === 304 && cached) return cached.value;
    if (response.status === 401) {
      cache.delete(key);
      throw new NTAuthError(401, "invalid_token", "The access token is no longer active");
    }
    if (response.status === 403) {
      cache.delete(key);
      throw new NTAuthError(403, "insufficient_scope", "The service grant is not active");
    }
    if (!response.ok) {
      throw new NTAuthError(503, "policy_unavailable", "Effective policies are unavailable");
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new NTAuthError(503, "policy_unavailable", "The effective policy response is invalid");
    }
    const value = parsePolicies(body, claims, response.headers.get("etag"));
    cache.set(key, { etag: value.etag, value });
    return value;
  }

  async function authenticate(request: Request): Promise<NTAuthRequestContext> {
    const token = bearerToken(request);
    const claims = await verify(token);
    const policies = await loadPolicies(token, claims);
    const scopes = claims.scope.split(" ").filter(Boolean);
    return {
      authorize(input: AuthorizationRequest) {
        return evaluatePolicy({
          action: input.action,
          context: input.context ?? {},
          resource: input.resource,
          statements: policies.statements,
        });
      },
      claims,
      identity: { id: claims.sub },
      organizationId: claims.organization_id,
      policies,
      scopes,
      service: claims.service,
    };
  }

  function invalidate(scope?: { organizationId: string; service: string; subjectUserId: string }) {
    if (!scope) cache.clear();
    else cache.delete(`${scope.subjectUserId}:${scope.organizationId}:${scope.service}`);
  }

  return { authenticate, invalidate, verify };
}

export type NTAuthClient = ReturnType<typeof createNTAuthClient>;
