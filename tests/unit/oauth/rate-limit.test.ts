import { createRateLimiter, ipFromRequest } from '../../../src/oauth/rate-limit';

function fixedNow(ms: number): () => number {
  return () => ms;
}

describe('createRateLimiter — basic consume', () => {
  it('allows requests under the limit and denies once exceeded', () => {
    const rl = createRateLimiter({ budgets: { oauth_device: 5, oauth_token: 30 }, now: fixedNow(1_000_000) });
    for (let i = 0; i < 5; i++) {
      expect(rl.consume('oauth_device', '1.2.3.4')).toBe(true);
    }
    expect(rl.consume('oauth_device', '1.2.3.4')).toBe(false);
  });

  it('counts separately per route', () => {
    const rl = createRateLimiter({ budgets: { oauth_device: 2, oauth_token: 2 }, now: fixedNow(1_000_000) });
    expect(rl.consume('oauth_device', '1.2.3.4')).toBe(true);
    expect(rl.consume('oauth_device', '1.2.3.4')).toBe(true);
    expect(rl.consume('oauth_device', '1.2.3.4')).toBe(false);
    // token route is independent
    expect(rl.consume('oauth_token', '1.2.3.4')).toBe(true);
    expect(rl.consume('oauth_token', '1.2.3.4')).toBe(true);
    expect(rl.consume('oauth_token', '1.2.3.4')).toBe(false);
  });

  it('counts separately per key (IP)', () => {
    const rl = createRateLimiter({ budgets: { oauth_device: 1, oauth_token: 1 }, now: fixedNow(1_000_000) });
    expect(rl.consume('oauth_device', '1.1.1.1')).toBe(true);
    expect(rl.consume('oauth_device', '1.1.1.1')).toBe(false);
    expect(rl.consume('oauth_device', '2.2.2.2')).toBe(true);
  });
});

describe('createRateLimiter — window reset', () => {
  it('resets after the 60s window advances', () => {
    let t = 1_000_000;
    const rl = createRateLimiter({ budgets: { oauth_device: 2, oauth_token: 2 }, now: () => t });
    expect(rl.consume('oauth_device', '1.2.3.4')).toBe(true);
    expect(rl.consume('oauth_device', '1.2.3.4')).toBe(true);
    expect(rl.consume('oauth_device', '1.2.3.4')).toBe(false);
    // advance to next minute
    t += 60_000;
    expect(rl.consume('oauth_device', '1.2.3.4')).toBe(true);
  });

  it('honors a custom windowMs', () => {
    let t = 1_000_000;
    const rl = createRateLimiter({
      budgets: { oauth_device: 1, oauth_token: 1 },
      windowMs: 1_000,
      now: () => t,
    });
    expect(rl.consume('oauth_device', 'k')).toBe(true);
    expect(rl.consume('oauth_device', 'k')).toBe(false);
    t += 1_000; // exactly one window later
    expect(rl.consume('oauth_device', 'k')).toBe(true);
  });
});

describe('createRateLimiter — status + reset', () => {
  it('status reports the current count and configured limit', () => {
    const rl = createRateLimiter({ budgets: { oauth_device: 3, oauth_token: 30 }, now: fixedNow(1_000_000) });
    expect(rl.status('oauth_device', 'k')).toEqual({ count: 0, limit: 3 });
    rl.consume('oauth_device', 'k');
    rl.consume('oauth_device', 'k');
    expect(rl.status('oauth_device', 'k')).toEqual({ count: 2, limit: 3 });
  });

  it('reset clears all counters', () => {
    const rl = createRateLimiter({ budgets: { oauth_device: 1, oauth_token: 1 }, now: fixedNow(1_000_000) });
    rl.consume('oauth_device', 'a');
    rl.consume('oauth_token', 'a');
    rl.reset();
    expect(rl.consume('oauth_device', 'a')).toBe(true);
    expect(rl.consume('oauth_token', 'a')).toBe(true);
  });
});

describe('ipFromRequest', () => {
  it('prefers req.ip when present', () => {
    expect(ipFromRequest({ ip: '10.0.0.1' })).toBe('10.0.0.1');
  });
  it('falls back to socket.remoteAddress', () => {
    expect(ipFromRequest({ socket: { remoteAddress: '10.0.0.2' } })).toBe('10.0.0.2');
  });
  it('returns "unknown" when neither is set', () => {
    expect(ipFromRequest({})).toBe('unknown');
  });
  it('ignores x-forwarded-for headers (untrusted in our deployment)', () => {
    expect(
      ipFromRequest({ headers: { 'x-forwarded-for': '1.1.1.1' } as Record<string, unknown> }),
    ).toBe('unknown');
  });
});
