import { extractBackendErrorMessage, normalizeBackendResponse } from '../../src/utils/backend-response';

describe('normalizeBackendResponse', () => {
  it('unwraps AEM success envelope', () => {
    const result = normalizeBackendResponse({
      status: 'success',
      data: { count: 3 },
      message: 'ok',
    });
    expect(result).toEqual({ count: 3 });
  });

  it('returns body unchanged when not an envelope', () => {
    const body = { count: 3 };
    expect(normalizeBackendResponse(body)).toBe(body);
  });
});

describe('extractBackendErrorMessage', () => {
  it('prefers message field', () => {
    expect(extractBackendErrorMessage({ message: 'Not found' }, 'fallback')).toBe('Not found');
  });

  it('falls back to default', () => {
    expect(extractBackendErrorMessage(null, 'fallback')).toBe('fallback');
  });
});
