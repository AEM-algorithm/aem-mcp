// In-process store for OAuth 2.0 authorization codes (RFC 6749 §4.1.2).
//
// Used by the authorization_code + PKCE flow that strict MCP clients
// (Cursor) drive. Codes are short-lived (5 min default), one-shot, and
// bound to: the user that approved, the client_id, the redirect_uri,
// and the PKCE code_challenge.

import { createHash, randomBytes } from 'node:crypto';

export type AuthCodeRow = {
  code: string;
  userId: number;
  jti: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: 'plain' | 'S256';
  expiresAt: string;
  consumed: boolean;
};

export type AuthCodesStore = {
  insert: (row: AuthCodeRow) => void;
  consume: (
    code: string,
    pkce: { codeVerifier: string; redirectUri: string },
  ) => AuthCodeRow | undefined;
};

export const AUTH_CODE_TTL_SECONDS = 300;

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function base64urlNoPad(buf: Buffer): string {
  return buf.toString('base64url').replace(/=+$/, '');
}

export function generateAuthorizationCode(): string {
  return base64urlNoPad(randomBytes(32));
}

export function verifyPkce(
  codeVerifier: string,
  codeChallenge: string,
  method: 'plain' | 'S256',
): boolean {
  if (method === 'plain') {
    return codeVerifier === codeChallenge;
  }
  if (method === 'S256') {
    const computed = base64urlNoPad(Buffer.from(sha256(codeVerifier), 'hex'));
    if (computed.length !== codeChallenge.length) return false;
    let diff = 0;
    for (let i = 0; i < computed.length; i++) {
      diff |= computed.charCodeAt(i) ^ codeChallenge.charCodeAt(i);
    }
    return diff === 0;
  }
  return false;
}

export function createAuthCodesStore(opts: { now?: () => number } = {}): AuthCodesStore {
  const now = opts.now ?? Date.now;
  const map = new Map<string, AuthCodeRow & { codeHash: string }>();

  function isExpired(row: AuthCodeRow): boolean {
    return Date.parse(row.expiresAt) <= now();
  }

  return {
    insert(row) {
      const codeHash = sha256(row.code);
      map.set(codeHash, { ...row, codeHash });
    },
    consume(code, pkce) {
      const codeHash = sha256(code);
      const row = map.get(codeHash);
      if (!row) return undefined;
      if (isExpired(row) || row.consumed) {
        map.delete(codeHash);
        return undefined;
      }
      if (row.redirectUri !== pkce.redirectUri) {
        return undefined;
      }
      if (!verifyPkce(pkce.codeVerifier, row.codeChallenge, row.codeChallengeMethod)) {
        return undefined;
      }
      const consumed: AuthCodeRow = { ...row, consumed: true };
      map.delete(codeHash);
      return consumed;
    },
  };
}

// RFC 8252 §7.3: public clients on loopback interfaces only.
export function isValidRedirectUri(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:') return false;
  const host = parsed.hostname.toLowerCase();
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') return false;
  if (parsed.username || parsed.password) return false;
  return true;
}
