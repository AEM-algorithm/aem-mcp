// OAuth error class per spec/standards.md `api/error-handling`.
// Standard codes are enumerated; httpStatus comes from the spec table.

export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'authorization_pending'
  | 'slow_down'
  | 'expired_token'
  | 'access_denied'
  | 'server_error'
  | 'temporarily_unavailable';

export class OAuthError extends Error {
  readonly code: OAuthErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: OAuthErrorCode, message: string, httpStatus: number, details?: unknown) {
    super(message);
    this.name = 'OAuthError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}
