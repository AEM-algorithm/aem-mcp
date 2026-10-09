import { createRevocationStore } from '../../../src/oauth/revocation';

describe('createRevocationStore', () => {
  it('returns false for unknown jti', () => {
    const store = createRevocationStore();
    expect(store.isRevoked('unknown')).toBe(false);
  });

  it('marks a jti as revoked and reports it', () => {
    const store = createRevocationStore();
    store.revoke('jti-1');
    expect(store.isRevoked('jti-1')).toBe(true);
  });

  it('is idempotent on revoke', () => {
    const store = createRevocationStore();
    store.revoke('jti-1');
    store.revoke('jti-1');
    expect(store.isRevoked('jti-1')).toBe(true);
  });

  it('exposes revokedAt timestamp when revoked', () => {
    const store = createRevocationStore();
    store.revoke('jti-1');
    const ts = store.revokedAt('jti-1');
    expect(typeof ts).toBe('number');
    expect(ts).toBeGreaterThan(0);
  });

  it('returns undefined revokedAt for unknown jti', () => {
    const store = createRevocationStore();
    expect(store.revokedAt('nope')).toBeUndefined();
  });
});
