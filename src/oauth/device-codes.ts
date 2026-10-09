// In-process device-code store per spec D2/D5.
// One-shot codes: a successful token exchange consumes the row.
// Expiration is a hard delete; we do not return expired codes from `get`.

import { createHash, randomBytes } from 'node:crypto';

import { OAuthError } from './errors';

export type DeviceCodeRow = {
  deviceCode: string;
  userCode: string;
  clientId: string;
  scope: string;
  expiresAt: string; // ISO
  intervalSeconds: number;
  status: 'pending' | 'approved' | 'denied';
  userId?: number;
  jti?: string;
};

export type DeviceCodesStore = {
  insert: (row: DeviceCodeRow) => void;
  get: (deviceCode: string) => DeviceCodeRow | undefined;
  approve: (deviceCode: string, userId: number, jti: string) => DeviceCodeRow;
  deny: (deviceCode: string) => DeviceCodeRow;
  remove: (deviceCode: string) => boolean;
};

export const DEVICE_CODE_TTL_SECONDS = 600; // 10 min per spec
export const DEVICE_CODE_INTERVAL_SECONDS = 5;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateDeviceCode(): string {
  // opaque 32-byte token, base64url
  return randomBytes(32).toString('base64url');
}

export function generateUserCode(): string {
  // XXXX-XXXX, unambiguous alphabet
  const alphabet = 'BCDFGHJKLMNPQRSTVWXZ23456789';
  const buf = randomBytes(8);
  let raw = '';
  for (let i = 0; i < 8; i++) {
    raw += alphabet[buf[i] % alphabet.length];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

export function hashDeviceCode(plaintext: string): string {
  return hashToken(plaintext);
}

export type IssueDeviceCodeInput = {
  clientId: string;
  scope: string;
  now?: () => number;
  ttlSeconds?: number;
  intervalSeconds?: number;
};

export type IssueDeviceCodeResult = {
  row: DeviceCodeRow;
  userCode: string;
  deviceCode: string; // plaintext (returned once to caller; only hash is stored)
  verificationUri: string;
  expiresAt: string;
  intervalSeconds: number;
};

export function createDeviceCodesStore(opts: {
  verificationUri: string;
  now?: () => number;
} = { verificationUri: 'https://app.example.com/agent-link' }): DeviceCodesStore {
  const now = opts.now ?? Date.now;
  const map = new Map<string, DeviceCodeRow>(); // key = sha256(deviceCode)

  function isExpired(row: DeviceCodeRow): boolean {
    return Date.parse(row.expiresAt) <= now();
  }

  return {
    insert(row) {
      map.set(hashDeviceCode(row.deviceCode), { ...row });
    },
    get(deviceCode) {
      const key = hashDeviceCode(deviceCode);
      const row = map.get(key);
      if (!row) {
        return undefined;
      }
      if (isExpired(row)) {
        map.delete(key);
        return undefined;
      }
      return row;
    },
    approve(deviceCode, userId, jti) {
      const key = hashDeviceCode(deviceCode);
      const row = map.get(key);
      if (!row) {
        throw new OAuthError('invalid_grant', 'unknown device_code', 400);
      }
      if (isExpired(row)) {
        map.delete(key);
        throw new OAuthError('expired_token', 'device_code expired', 400);
      }
      if (row.status !== 'pending') {
        throw new OAuthError('invalid_grant', `device_code already ${row.status}`, 400);
      }
      const updated: DeviceCodeRow = { ...row, status: 'approved', userId, jti };
      map.set(key, updated);
      return updated;
    },
    deny(deviceCode) {
      const key = hashDeviceCode(deviceCode);
      const row = map.get(key);
      if (!row) {
        throw new OAuthError('invalid_grant', 'unknown device_code', 400);
      }
      const updated: DeviceCodeRow = { ...row, status: 'denied' };
      map.set(key, updated);
      return updated;
    },
    remove(deviceCode) {
      return map.delete(hashDeviceCode(deviceCode));
    },
  };
}

export function issueDeviceCode(
  store: DeviceCodesStore,
  input: IssueDeviceCodeInput
): IssueDeviceCodeResult {
  const ttl = input.ttlSeconds ?? DEVICE_CODE_TTL_SECONDS;
  const interval = input.intervalSeconds ?? DEVICE_CODE_INTERVAL_SECONDS;
  const nowMs = input.now ? input.now() : Date.now();
  const deviceCode = generateDeviceCode();
  const userCode = generateUserCode();
  const expiresAt = new Date(nowMs + ttl * 1000).toISOString();
  const row: DeviceCodeRow = {
    deviceCode,
    userCode,
    clientId: input.clientId,
    scope: input.scope,
    expiresAt,
    intervalSeconds: interval,
    status: 'pending',
  };
  store.insert(row);
  return {
    row,
    userCode,
    deviceCode,
    verificationUri: 'https://app.example.com/agent-link',
    expiresAt,
    intervalSeconds: interval,
  };
}
