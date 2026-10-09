import { createDeviceCodeStore, type DeviceCodeEntry } from '../../../src/oauth/device-codes';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';

function tmpBackupPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aem-mcp-device-codes-'));
  return join(dir, 'device-codes-backup.json');
}

describe('createDeviceCodeStore', () => {
  describe('issue', () => {
    it('returns a device_code and a user_code matching /^[A-Z0-9]{4}-[A-Z0-9]{4}$/', () => {
      const store = createDeviceCodeStore({ ttlSeconds: 600, intervalSeconds: 2, backupPath: null });
      const entry = store.issue({ ip: '127.0.0.1' });
      expect(entry.device_code).toMatch(/^[a-f0-9-]{36}$/); // uuid
      expect(entry.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(entry.expires_in).toBe(600);
      expect(entry.interval).toBe(2);
      expect(entry.verification_uri).toBe('https://aem-mcp/oauth/authorize');
      expect(entry.status).toBe('issued');
      expect(typeof entry.issuedAt).toBe('number');
    });

    it('generates unique device_codes and user_codes', () => {
      const store = createDeviceCodeStore({ ttlSeconds: 600, intervalSeconds: 2, backupPath: null });
      const a = store.issue({ ip: '127.0.0.1' });
      const b = store.issue({ ip: '127.0.0.1' });
      expect(a.device_code).not.toBe(b.device_code);
      expect(a.user_code).not.toBe(b.user_code);
    });

    it('generates retry-stable user_code until collision (10k trials)', () => {
      const store = createDeviceCodeStore({ ttlSeconds: 600, intervalSeconds: 2, backupPath: null });
      const seen = new Set<string>();
      for (let i = 0; i < 10_000; i += 1) {
        const e = store.issue({ ip: '127.0.0.1' });
        expect(seen.has(e.user_code)).toBe(false);
        seen.add(e.user_code);
      }
    });
  });

  describe('get', () => {
    it('returns the entry by device_code', () => {
      const store = createDeviceCodeStore({ ttlSeconds: 600, intervalSeconds: 2, backupPath: null });
      const e = store.issue({ ip: '127.0.0.1' });
      expect(store.get(e.device_code)).toMatchObject({ device_code: e.device_code });
    });

    it('returns undefined for unknown device_code', () => {
      const store = createDeviceCodeStore({ ttlSeconds: 600, intervalSeconds: 2, backupPath: null });
      expect(store.get('not-a-real-code')).toBeUndefined();
    });

    it('returns undefined after expiry', () => {
      const store = createDeviceCodeStore({ ttlSeconds: 0, intervalSeconds: 2, backupPath: null });
      const e = store.issue({ ip: '127.0.0.1' });
      // Sleep 5ms so issuedAt < now; ttl=0 should mark expired
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      return wait(5).then(() => {
        expect(store.get(e.device_code)).toBeUndefined();
      });
    });

    it('finds by user_code', () => {
      const store = createDeviceCodeStore({ ttlSeconds: 600, intervalSeconds: 2, backupPath: null });
      const e = store.issue({ ip: '127.0.0.1' });
      const found = store.getByUserCode(e.user_code);
      expect(found).toMatchObject({ device_code: e.device_code });
    });
  });

  describe('setStatus', () => {
    it('updates status from issued to approved', () => {
      const store = createDeviceCodeStore({ ttlSeconds: 600, intervalSeconds: 2, backupPath: null });
      const e = store.issue({ ip: '127.0.0.1' });
      const ok = store.setStatus(e.device_code, 'approved', { userId: 42 });
      expect(ok).toBe(true);
      const updated = store.get(e.device_code) as DeviceCodeEntry;
      expect(updated.status).toBe('approved');
      expect(updated.userId).toBe(42);
    });

    it('returns false for unknown device_code', () => {
      const store = createDeviceCodeStore({ ttlSeconds: 600, intervalSeconds: 2, backupPath: null });
      expect(store.setStatus('nope', 'approved', { userId: 1 })).toBe(false);
    });
  });

  describe('consume', () => {
    it('removes the entry and returns it (single-use)', () => {
      const store = createDeviceCodeStore({ ttlSeconds: 600, intervalSeconds: 2, backupPath: null });
      const e = store.issue({ ip: '127.0.0.1' });
      const consumed = store.consume(e.device_code);
      expect(consumed?.device_code).toBe(e.device_code);
      expect(store.get(e.device_code)).toBeUndefined();
    });

    it('returns undefined when already consumed', () => {
      const store = createDeviceCodeStore({ ttlSeconds: 600, intervalSeconds: 2, backupPath: null });
      const e = store.issue({ ip: '127.0.0.1' });
      store.consume(e.device_code);
      expect(store.consume(e.device_code)).toBeUndefined();
    });
  });

  describe('filesystem backup', () => {
    it('persists entries to backup file on issue + setStatus', () => {
      const path = tmpBackupPath();
      try {
        const store = createDeviceCodeStore({ ttlSeconds: 600, intervalSeconds: 2, backupPath: path });
        const e = store.issue({ ip: '127.0.0.1' });
        store.setStatus(e.device_code, 'approved', { userId: 7 });

        const restored = createDeviceCodeStore({ ttlSeconds: 600, intervalSeconds: 2, backupPath: path });
        const r = restored.get(e.device_code);
        expect(r).toMatchObject({ device_code: e.device_code, status: 'approved', userId: 7 });
      } finally {
        rmSync(join(path, '..'), { recursive: true, force: true });
      }
    });

    it('starts fresh when backup file is missing', () => {
      const path = tmpBackupPath();
      // do not create file
      const store = createDeviceCodeStore({ ttlSeconds: 600, intervalSeconds: 2, backupPath: path });
      expect(store.size).toBe(0);
    });
  });
});
