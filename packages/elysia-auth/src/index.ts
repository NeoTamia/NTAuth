export interface NTAuthAccessTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  jti: string;
  organization_id: string;
  service: string;
  scope: string;
  policies_etag: string;
}
