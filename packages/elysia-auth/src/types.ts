import type { JWTPayload } from "jose";

import type {
  PolicyConditionContext,
  PolicyDecision,
  PolicyStatement,
} from "@neotamia/permissions";

export interface NTAuthAccessTokenClaims extends JWTPayload {
  iss: string;
  sub: string;
  aud: string | string[];
  azp: string;
  exp: number;
  iat: number;
  jti: string;
  sid: string;
  organization_id: string;
  service: string;
  scope: string;
  policies_etag: string;
}

export interface EffectivePolicies {
  etag: string;
  organizationId: string;
  service: string;
  subjectUserId: string;
  statements: PolicyStatement[];
}

export interface NTAuthContext {
  claims: NTAuthAccessTokenClaims;
  identity: { id: string };
  organizationId: string;
  policies: EffectivePolicies;
  scopes: readonly string[];
  service: string;
}

export interface AuthorizationRequest {
  action: string;
  context?: PolicyConditionContext;
  resource: string;
}

export interface NTAuthRequestContext extends NTAuthContext {
  authorize(request: AuthorizationRequest): PolicyDecision;
}
