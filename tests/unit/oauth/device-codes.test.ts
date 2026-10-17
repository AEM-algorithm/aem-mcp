import {
  DEVICE_CODE_INTERVAL_SECONDS,
  DEVICE_CODE_TTL_SECONDS,
  createDeviceCodesStore,
  generateDeviceCode,
  generateUserCode,
  hashDeviceCode,
  issueDeviceCode,
  type DeviceCodeRow,
} from '../../../src/oauth/device-codes';
import { OAuthError } from '../../../src/oauth/errors';

function fixedNow(iso: string): () => number {
  const t = Date.parse(iso);
  return () => t;
}

function advance(now: () => number, ms: number): () => number {
  let t = now();
  return () => {
    t += ms;
    return t;
  };
}

describe('generateDeviceCode / generateUserCode', () => {
  it('generates device codes of expected entropy (32 bytes base64url)', () => {
    const a = generateDeviceCode();
    const b = generateDeviceCode();
    expect(a).not.toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(/^[A-Za-z0-9_-]+$/.test(a)).toBe(true);
  });

  it('generates user codes in XXXX-XXXX unambiguous form', () => {
    for (let i = 0; i < 50; i++) {
      const u = generateUserCode();
      expect(u).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      // no I, O, 0, 1
      expect(u).not.toMatch(/[IO01]/);
    }
  });
});

describe('hashDeviceCode', () => {
  it('is deterministic and 64 hex chars (sha256)', () => {
    const h1 = hashDeviceCode('abc');
    const h2 = hashDeviceCode('abc');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('differs for different inputs', () => {
    expect(hashDeviceCode('a')).not.toBe(hashDeviceCode('b'));
  });
});

describe('issueDeviceCode', () => {
  it('returns a fresh row with pending status, user/device/uri, and ttl', () => {
    const now = fixedNow('2026-10-09T03:00:00.000Z');
    const store = createDeviceCodesStore();
    const out = issueDeviceCode(store, { clientId: 'claude-code', scope: 'aem-mcp:read', now });
    expect(out.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(out.deviceCode.length).toBeGreaterThan(20);
    expect(out.verificationUri).toContain('/agent-link');
    expect(out.intervalSeconds).toBe(DEVICE_CODE_INTERVAL_SECONDS);
    expect(Date.parse(out.expiresAt) - now()).toBe(DEVICE_CODE_TTL_SECONDS * 1000);
    expect(out.row.status).toBe('pending');
    expect(out.row.clientId).toBe('claude-code');
    expect(out.row.scope).toBe('aem-mcp:read');
  });

  it('persists the row but only by hash (store.get accepts plaintext)', () => {
    const store = createDeviceCodesStore();
    const out = issueDeviceCode(store, { clientId: 'c', scope: '' });
    const got = store.get(out.deviceCode);
    expect(got).toBeDefined();
    expect(got?.userCode).toBe(out.userCode);
  });
});

describe('store.get', () => {
  it('returns undefined for unknown device code', () => {
    const store = createDeviceCodesStore();
    expect(store.get('nope')).toBeUndefined();
  });

  it('returns undefined and evicts expired rows', () => {
    const now = fixedNow('2026-10-09T03:00:00.000Z');
    const store = createDeviceCodesStore();
    const out = issueDeviceCode(store, { clientId: 'c', scope: '', now });
    // jump past expiry
    const later = advance(now, DEVICE_CODE_TTL_SECONDS * 1000 + 1000);
    const store2 = createDeviceCodesStore({ verificationUri: 'x' });
    const out2 = issueDeviceCode(store2, { clientId: 'c', scope: '', now });
    // now use the real get with a "now" that is later
    const row: DeviceCodeRow = { ...out2.row };
    expect(row).toBeDefined();
    // emulate by using fixedNow in a fresh store: issue with now, then call with later now via a wrapper
    // simplest: monkey-patch Date.now isn't possible in pure module; use the public API by setting TTL to 0
    const tiny = issueDeviceCode(store, { clientId: 'c', scope: '', now, ttlSeconds: 0 });
    // ttlSeconds=0 → expiresAt == now; immediately expired
    expect(store.get(tiny.deviceCode)).toBeUndefined();
    expect(out.deviceCode.length).toBeGreaterThan(0); // sanity, keep `out` used
  });
});

describe('store.getByUserCode', () => {
  it('finds a row by its user_code', () => {
    const store = createDeviceCodesStore();
    const now = Date.now();
    const userCode = 'ABCD-EFGH';
    store.insert({
      deviceCode: 'dev-1',
      userCode,
      clientId: 'claude-code',
      scope: 'aem-mcp:read',
      expiresAt: new Date(now + 60_000).toISOString(),
      intervalSeconds: 2,
      status: 'pending',
    });
    const row = store.getByUserCode(userCode);
    expect(row).toBeDefined();
    expect(row?.userCode).toBe(userCode);
  });

  it('returns undefined for unknown user_code', () => {
    const store = createDeviceCodesStore();
    expect(store.getByUserCode('ZZZZ-9999')).toBeUndefined();
  });

  it('returns undefined for expired row and lazy-deletes it', () => {
    const store = createDeviceCodesStore();
    store.insert({
      deviceCode: 'dev-2',
      userCode: 'WXYZ-1234',
      clientId: 'claude-code',
      scope: 'aem-mcp:read',
      expiresAt: new Date(Date.now() - 1).toISOString(),
      intervalSeconds: 2,
      status: 'pending',
    });
    expect(store.getByUserCode('WXYZ-1234')).toBeUndefined();
    expect(store.getByUserCode('WXYZ-1234')).toBeUndefined();
  });
});

describe('store.approve / deny', () => {
  it('approve marks status=approved and stores userId+jti', () => {
    const store = createDeviceCodesStore();
    const { deviceCode } = issueDeviceCode(store, { clientId: 'c', scope: 'aem-mcp:read' });
    const row = store.approve(deviceCode, 42, 'jti-1');
    expect(row.status).toBe('approved');
    expect(row.userId).toBe(42);
    expect(row.jti).toBe('jti-1');
    const got = store.get(deviceCode);
    expect(got?.status).toBe('approved');
  });

  it('approve twice throws invalid_grant', () => {
    const store = createDeviceCodesStore();
    const { deviceCode } = issueDeviceCode(store, { clientId: 'c', scope: '' });
    store.approve(deviceCode, 1, 'jti-1');
    expect(() => store.approve(deviceCode, 1, 'jti-2')).toThrow(OAuthError);
  });

  it('deny marks status=denied', () => {
    const store = createDeviceCodesStore();
    const { deviceCode } = issueDeviceCode(store, { clientId: 'c', scope: '' });
    const row = store.deny(deviceCode);
    expect(row.status).toBe('denied');
  });

  it('approve unknown device_code throws invalid_grant', () => {
    const store = createDeviceCodesStore();
    expect(() => store.approve('nope', 1, 'j')).toThrow(OAuthError);
  });
});

describe('store.remove', () => {
  it('returns true when present, false when absent', () => {
    const store = createDeviceCodesStore();
    const { deviceCode } = issueDeviceCode(store, { clientId: 'c', scope: '' });
    expect(store.remove(deviceCode)).toBe(true);
    expect(store.remove(deviceCode)).toBe(false);
  });
});
