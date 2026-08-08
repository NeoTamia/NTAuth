export type NTAuthProtocolErrorCode =
  | "callback_error"
  | "invalid_callback"
  | "invalid_transaction"
  | "session_unavailable";

export class NTAuthProtocolError extends Error {
  readonly code: NTAuthProtocolErrorCode;
  readonly status: number;

  constructor(code: NTAuthProtocolErrorCode, message: string, status = 400) {
    super(message);
    this.name = "NTAuthProtocolError";
    this.code = code;
    this.status = status;
  }
}
