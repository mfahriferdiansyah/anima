/**
 * Cross-tab single-sealer lease (plan 2026-06-24 U5). The node test env has no
 * Web Locks API, so this exercises the graceful FALLBACK path (immediate grant +
 * a flag so the caller keeps manual Save reachable) and the lease lifecycle. The
 * real Web Locks failover (a killed leader auto-releasing) is a browser behavior
 * verified live (U12).
 */
import { describe, it, expect, vi } from 'vitest';
import { acquireSealLease } from './ownerLock';

describe('acquireSealLease — fallback when Web Locks is unavailable', () => {
  it('grants immediately and flags the fallback so manual Save stays reachable', () => {
    let acquired = false;
    const lease = acquireSealLease('room-1', () => (acquired = true));
    expect(lease.isHeld()).toBe(true);
    expect(lease.isFallback()).toBe(true);
    expect(acquired).toBe(true);
  });

  it('release drops the held flag', () => {
    const lease = acquireSealLease('room-2');
    expect(lease.isHeld()).toBe(true);
    lease.release();
    expect(lease.isHeld()).toBe(false);
  });
});

describe('acquireSealLease — with a Web Locks API present', () => {
  it('holds the exclusive lock and is NOT a fallback; release resolves the lock', async () => {
    // Stub a minimal navigator.locks that grants exclusively and holds until the
    // callback promise resolves (the real API contract).
    const request = vi.fn((_name: string, _opts: unknown, cb: () => Promise<void>) => {
      return cb(); // grant immediately; the returned promise holds the lock
    });
    vi.stubGlobal('navigator', { locks: { request } });

    try {
      let acquired = false;
      const lease = acquireSealLease('room-3', () => (acquired = true));
      await Promise.resolve();
      expect(request).toHaveBeenCalledOnce();
      expect(acquired).toBe(true);
      expect(lease.isHeld()).toBe(true);
      expect(lease.isFallback()).toBe(false);

      lease.release();
      expect(lease.isHeld()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
