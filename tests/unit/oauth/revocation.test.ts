import { createRevocationStore, hashJti } from '../../../src/oauth/revocation';

describe('createRevocationStore', () => {
  it('starts empty: nothing revoked', () => {
    const s = createRevocationStore();
    expect(s.isRevoked('jti-1')).toBe(false);
    expect(s.list()).toEqual([]);
  });

  it('revoke returns a record and marks jti as revoked', () => {
    const s = createRevocationStore();
    const rec = s.revoke('jti-1', 'claude-code');
    expect(rec.jti).toBe('jti-1');
    expect(rec.clientId).toBe('claude-code');
    expect(rec.revokedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(s.isRevoked('jti-1')).toBe(true);
  });

  it('records parentJti when provided (refresh→access chain)', () => {
    const s = createRevocationStore();
    const rec = s.revoke('jti-access', 'claude-code', 'jti-refresh');
    expect(rec.parentJti).toBe('jti-refresh');
  });

  it('list returns all revoked records in insertion order', () => {
    const s = createRevocationStore();
    const a = s.revoke('a', 'c1');
    const b = s.revoke('b', 'c2', 'bp');
    expect(s.list()).toEqual([a, b]);
  });

  it('is idempotent for the same jti (revoke twice keeps the first record)', () => {
    const s = createRevocationStore();
    const a = s.revoke('jti-1', 'c1');
    const b = s.revoke('jti-1', 'c1');
    expect(s.list()).toEqual([a]);
    expect(b.jti).toBe('jti-1'); // returned but not added
  });
});

describe('hashJti', () => {
  it('is deterministic and 64 hex chars', () => {
    const h = hashJti('jti-1');
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(hashJti('jti-1')).toBe(h);
  });

  it('differs for different jtis', () => {
    expect(hashJti('a')).not.toBe(hashJti('b'));
  });
});
