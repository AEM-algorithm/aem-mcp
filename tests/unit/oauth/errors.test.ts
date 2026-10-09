import { OAuthError, OAuthErrorCode } from '../../../src/oauth/errors';

describe('OAuthError', () => {
  it('is an instance of Error and OAuthError', () => {
    const e = new OAuthError('invalid_request', 'missing field', 400);
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(OAuthError);
    expect(e.name).toBe('OAuthError');
  });

  it('exposes code, message, httpStatus, and optional details', () => {
    const details = { field: 'device_code' };
    const e = new OAuthError('invalid_grant', 'unknown device_code', 400, details);
    expect(e.code).toBe('invalid_grant');
    expect(e.message).toBe('unknown device_code');
    expect(e.httpStatus).toBe(400);
    expect(e.details).toEqual(details);
  });

  it('accepts all standard codes defined by spec', () => {
    const codes: OAuthErrorCode[] = [
      'invalid_request',
      'invalid_client',
      'invalid_grant',
      'unauthorized_client',
      'unsupported_grant_type',
      'invalid_scope',
      'authorization_pending',
      'slow_down',
      'expired_token',
      'access_denied',
      'server_error',
      'temporarily_unavailable',
    ];
    for (const code of codes) {
      const e = new OAuthError(code, 'msg', 400);
      expect(e.code).toBe(code);
    }
  });

  it('has stable JSON shape for handleHttpError', () => {
    const e = new OAuthError('authorization_pending', 'pending', 400);
    expect({ code: e.code, message: e.message, httpStatus: e.httpStatus }).toEqual({
      code: 'authorization_pending',
      message: 'pending',
      httpStatus: 400,
    });
  });
});
