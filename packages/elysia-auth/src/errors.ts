export type NTAuthErrorCode =
  | "authentication_required"
  | "invalid_token"
  | "insufficient_scope"
  | "policy_unavailable";

export class NTAuthError extends Error {
  readonly code: NTAuthErrorCode;
  readonly status: 401 | 403 | 503;

  constructor(status: 401 | 403 | 503, code: NTAuthErrorCode, message: string) {
    super(message);
    this.name = "NTAuthError";
    this.code = code;
    this.status = status;
  }

  toResponse() {
    const headers = new Headers({ "content-type": "application/problem+json" });
    if (this.status === 401) {
      headers.set("www-authenticate", `Bearer error="${this.code}"`);
    } else if (this.status === 403) {
      headers.set("www-authenticate", 'Bearer error="insufficient_scope"');
    }
    return Response.json(
      {
        code: this.code,
        status: this.status,
        title: this.message,
        type: `urn:ntauth:error:${this.code}`,
      },
      { headers, status: this.status },
    );
  }
}
