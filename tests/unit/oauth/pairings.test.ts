import { createPairingsStore, type Pairing } from '../../../src/oauth/pairings';

describe('createPairingsStore', () => {
  it('starts empty', () => {
    const store = createPairingsStore();
    expect(store.listByUser(1)).toEqual([]);
  });

  it('adds and retrieves a pairing by userId + jti', () => {
    const store = createPairingsStore();
    const pairing: Pairing = {
      jti: 'jti-1',
      userId: 1,
      clientId: 'claude-code',
      userCode: 'ABCD-1234',
      approvedAt: '2026-10-09T03:00:00.000Z',
      deviceCode: 'dc-1',
    };
    store.add(pairing);
    expect(store.get('jti-1')).toEqual(pairing);
    expect(store.listByUser(1)).toEqual([pairing]);
  });

  it('listByUser returns only that user', () => {
    const store = createPairingsStore();
    const a: Pairing = {
      jti: 'jti-a',
      userId: 1,
      clientId: 'claude-code',
      userCode: 'AAAA-1111',
      approvedAt: '2026-10-09T03:00:00.000Z',
      deviceCode: 'dc-a',
    };
    const b: Pairing = {
      jti: 'jti-b',
      userId: 2,
      clientId: 'cursor',
      userCode: 'BBBB-2222',
      approvedAt: '2026-10-09T03:01:00.000Z',
      deviceCode: 'dc-b',
    };
    store.add(a);
    store.add(b);
    expect(store.listByUser(1)).toEqual([a]);
    expect(store.listByUser(2)).toEqual([b]);
  });

  it('removes a pairing by jti', () => {
    const store = createPairingsStore();
    const p: Pairing = {
      jti: 'jti-1',
      userId: 1,
      clientId: 'claude-code',
      userCode: 'AAAA-1111',
      approvedAt: '2026-10-09T03:00:00.000Z',
      deviceCode: 'dc-1',
    };
    store.add(p);
    expect(store.remove('jti-1')).toBe(true);
    expect(store.get('jti-1')).toBeUndefined();
    expect(store.remove('jti-1')).toBe(false);
  });

  it('is not shared across instances (in-process only)', () => {
    const s1 = createPairingsStore();
    const s2 = createPairingsStore();
    s1.add({
      jti: 'jti-x',
      userId: 1,
      clientId: 'x',
      userCode: 'AAAA-1111',
      approvedAt: '2026-10-09T03:00:00.000Z',
      deviceCode: 'dc-x',
    });
    expect(s2.get('jti-x')).toBeUndefined();
  });
});
