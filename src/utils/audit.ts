// Audit log helpers for OAuth events (Phase 8).
//
// All events are emitted via the standard `logInfo`/`logError` channels
// so they land in the same stream as operational logs. The 6 event
// types below are the contract for downstream SIEM / compliance tools.

import { logError, logInfo } from './logger';

export type AuditEvent =
  // 1. A new device code was issued.
  | 'oauth.device.issued'
  // 2. The user submitted the login form and we received an exchange code.
  | 'oauth.exchange.received'
  // 3. The device code was bound to a verified user (approved).
  | 'oauth.device.approved'
  // 4. A token was minted.
  | 'oauth.token.issued'
  // 5. A token was revoked (either via /oauth/revoke or DELETE /api/agents/:jti).
  | 'oauth.token.revoked'
  // 6. A token was rejected (revoked, expired, bad audience, etc.).
  | 'oauth.token.rejected';

type BaseFields = {
  ip?: string;
  userId?: number;
  jti?: string;
  clientId?: string;
  userCode?: string;
  reason?: string;
};

function emit(event: AuditEvent, fields: BaseFields = {}): void {
  const payload = { event, ...stripUndefined(fields) };
  if (event === 'oauth.token.rejected') {
    logError(event, payload);
  } else {
    logInfo(event, payload);
  }
}

function stripUndefined(fields: BaseFields): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

export const audit = {
  deviceIssued(fields: BaseFields): void {
    emit('oauth.device.issued', fields);
  },
  exchangeReceived(fields: BaseFields): void {
    emit('oauth.exchange.received', fields);
  },
  deviceApproved(fields: BaseFields): void {
    emit('oauth.device.approved', fields);
  },
  tokenIssued(fields: BaseFields): void {
    emit('oauth.token.issued', fields);
  },
  tokenRevoked(fields: BaseFields): void {
    emit('oauth.token.revoked', fields);
  },
  tokenRejected(fields: BaseFields): void {
    emit('oauth.token.rejected', fields);
  },
};
