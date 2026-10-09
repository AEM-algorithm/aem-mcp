import { audit } from '../../../src/utils/audit';

describe('audit events', () => {
  let infoSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    infoSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('emits oauth.device.issued via logInfo', () => {
    audit.deviceIssued({ ip: '127.0.0.1', clientId: 'claude-code', userCode: 'ABCD-EFGH' });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(infoSpy.mock.calls[0][0]);
    expect(payload.event).toBe('oauth.device.issued');
    expect(payload.ip).toBe('127.0.0.1');
    expect(payload.clientId).toBe('claude-code');
    expect(payload.userCode).toBe('ABCD-EFGH');
  });

  it('emits oauth.token.rejected via logError (not logInfo)', () => {
    audit.tokenRejected({ jti: 'j-1', reason: 'revoked' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).not.toHaveBeenCalled();
    const payload = JSON.parse(errorSpy.mock.calls[0][0]);
    expect(payload.level).toBe('error');
    expect(payload.event).toBe('oauth.token.rejected');
    expect(payload.jti).toBe('j-1');
  });

  it('strips undefined fields', () => {
    audit.tokenIssued({ userId: 7, jti: 'j-2' });
    const payload = JSON.parse(infoSpy.mock.calls[0][0]);
    expect(payload.userId).toBe(7);
    expect(payload.jti).toBe('j-2');
    // logger adds `level`; stripUndefined handles only event fields
    expect(payload.level).toBe('info');
    expect(payload.event).toBe('oauth.token.issued');
    // no `undefined` keys leaked through
    expect(Object.keys(payload).sort()).toEqual(['event', 'jti', 'level', 'userId']);
  });

  it('emits all 6 event types without throwing', () => {
    audit.deviceIssued({});
    audit.exchangeReceived({});
    audit.deviceApproved({});
    audit.tokenIssued({});
    audit.tokenRevoked({});
    audit.tokenRejected({});
    // 5 positive events via logInfo (deviceIssued, exchangeReceived,
    // deviceApproved, tokenIssued, tokenRevoked); 1 rejected via logError.
    expect(infoSpy).toHaveBeenCalledTimes(5);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
