export interface NTAuthAccessTokenClaims {
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
