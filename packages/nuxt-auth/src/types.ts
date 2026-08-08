export interface NTAuthIdentity {
  email?: string;
  emailVerified?: boolean;
  id: string;
  name?: string;
}

export interface NTAuthSessionSnapshot {
  expiresAt: string;
  identity: NTAuthIdentity;
  organizationId?: string;
  scopes: string[];
  service?: string;
}

export interface AuthorizationTransaction {
  codeVerifier: string;
  createdAt: number;
  nonce: string;
  returnTo: string;
  state: string;
}

export interface AuthorizationRequest extends AuthorizationTransaction {
  authorizationUrl: string;
  codeChallenge: string;
}

export interface CallbackParameters {
  code: string;
  iss?: string;
  state: string;
}

export type SessionStatus = "authenticated" | "loading" | "anonymous" | "error";
