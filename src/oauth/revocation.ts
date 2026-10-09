// Token revocation per spec D6.
// Single endpoint: POST /oauth/revoke { token, token_type_hint? }
// revokes both access (jti) and refresh (parent jti chain).
// For Phase 3a we ship a minimal in-memory table; Phase 4 will wire to DB.

import { createHash } from 'node:crypto';

export type RevocationRecord = {
  jti: string;
  parentJti?: string;
  revokedAt: string;
  clientId: string;
};

export type RevocationStore = {
  revoke: (jti: string, clientId: string, parentJti?: string) => RevocationRecord;
  isRevoked: (jti: string) => boolean;
  list: () => RevocationRecord[];
};

function nowIso(): string {
  return new Date().toISOString();
}

export function hashJti(jti: string): string {
  return createHash('sha256').update(jti).digest('hex');
}

export function createRevocationStore(): RevocationStore {
  // store by hash(jti) for O(1) lookup; the plaintext jti is never stored at rest
  const table = new Map<string, RevocationRecord>();
  const records: RevocationRecord[] = [];

  return {
    revoke(jti, clientId, parentJti) {
      const key = hashJti(jti);
      const existing = table.get(key);
      if (existing) {
        return existing;
      }
      const rec: RevocationRecord = {
        jti,
        parentJti,
        revokedAt: nowIso(),
        clientId,
      };
      table.set(key, rec);
      records.push(rec);
      return rec;
    },
    isRevoked(jti) {
      return table.has(hashJti(jti));
    },
    list() {
      return [...records];
    },
  };
}
