/**
 * DOM-free auth-handshake test (no jsdom, no testing-library). The core takes
 * injected deps, so it needs no module mocks — only `@mysten/dapp-kit` is
 * stubbed, because importing `./auth` transitively loads it for `useAuth`, and
 * its wallet-standard internals are not node-safe under vitest. The hook itself
 * is not exercised here (it is the thin, untested wiring).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mysten/dapp-kit', () => ({
  useSignPersonalMessage: () => ({ mutateAsync: async () => ({ bytes: '', signature: '' }) }),
  useCurrentAccount: () => null,
}));

import {
  runAuthHandshake,
  ensureJwt,
  getJwt,
  clearJwt,
  __resetAuthForTests,
} from './auth';

const BACKEND = 'http://localhost:8080';
const ADDRESS = '0xowner';

/** A fake fetch: `/auth/nonce` → {nonce}, `/auth/verify` → {token} (or a !ok status). */
function makeFetch(opts: { verifyStatus?: number } = {}) {
  const { verifyStatus = 200 } = opts;
  return vi.fn(async (url: string | URL) => {
    const u = String(url);
    if (u.endsWith('/auth/nonce')) {
      return { ok: true, status: 200, json: async () => ({ nonce: 'anima:1:abc' }) } as Response;
    }
    if (u.endsWith('/auth/verify')) {
      const ok = verifyStatus >= 200 && verifyStatus < 300;
      return { ok, status: verifyStatus, json: async () => ({ token: ok ? 'jwt.token' : '' }) } as Response;
    }
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;
}

const signPersonalMessage = vi.fn(async () => ({ signature: 'sig' }));

beforeEach(() => {
  __resetAuthForTests();
  signPersonalMessage.mockClear();
});

describe('web3/auth: runAuthHandshake', () => {
  it('signs the nonce and POSTs address+nonce+signature to verify, returning the token', async () => {
    const fetchImpl = makeFetch();
    const token = await runAuthHandshake({ backendUrl: BACKEND, address: ADDRESS, signPersonalMessage, fetchImpl });

    expect(token).toBe('jwt.token');
    expect(signPersonalMessage).toHaveBeenCalledTimes(1);

    const verifyCall = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      ([url]) => String(url).endsWith('/auth/verify'),
    );
    expect(verifyCall).toBeDefined();
    const body = JSON.parse((verifyCall?.[1] as RequestInit).body as string);
    expect(body).toEqual({ address: ADDRESS, nonce: 'anima:1:abc', signature: 'sig' });
  });

  it('rejects with a clear message when verify returns a non-ok status', async () => {
    const fetchImpl = makeFetch({ verifyStatus: 401 });
    await expect(
      runAuthHandshake({ backendUrl: BACKEND, address: ADDRESS, signPersonalMessage, fetchImpl }),
    ).rejects.toThrow('auth/verify rejected: HTTP 401');
  });
});

describe('web3/auth: ensureJwt caching + dedup', () => {
  it('caches the token so a second ensureJwt runs no extra handshake', async () => {
    const fetchImpl = makeFetch();
    const deps = { backendUrl: BACKEND, address: ADDRESS, signPersonalMessage, fetchImpl };

    const first = await ensureJwt(deps);
    const second = await ensureJwt(deps);

    expect(first).toBe('jwt.token');
    expect(second).toBe('jwt.token');
    expect(getJwt(ADDRESS)).toBe('jwt.token');
    // exactly one handshake: one nonce + one verify fetch, one signature
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(signPersonalMessage).toHaveBeenCalledTimes(1);
  });

  it('shares one in-flight handshake across concurrent callers (no double sign)', async () => {
    // fetch that resolves after a tick, so both ensureJwt calls overlap
    const fetchImpl = vi.fn(async (url: string | URL) => {
      await Promise.resolve();
      const u = String(url);
      if (u.endsWith('/auth/nonce')) return { ok: true, status: 200, json: async () => ({ nonce: 'n' }) } as Response;
      return { ok: true, status: 200, json: async () => ({ token: 'jwt.token' }) } as Response;
    }) as unknown as typeof fetch;
    const deps = { backendUrl: BACKEND, address: ADDRESS, signPersonalMessage, fetchImpl };

    const [a, b] = await Promise.all([ensureJwt(deps), ensureJwt(deps)]);

    expect(a).toBe('jwt.token');
    expect(b).toBe(a);
    expect(signPersonalMessage).toHaveBeenCalledTimes(1);
    const nonceCalls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) =>
      String(url).endsWith('/auth/nonce'),
    );
    expect(nonceCalls).toHaveLength(1);
  });

  it('clearJwt drops the cache so the next ensureJwt re-runs the handshake', async () => {
    const fetchImpl = makeFetch();
    const deps = { backendUrl: BACKEND, address: ADDRESS, signPersonalMessage, fetchImpl };

    await ensureJwt(deps);
    expect(getJwt(ADDRESS)).toBe('jwt.token');

    clearJwt(ADDRESS);
    expect(getJwt(ADDRESS)).toBeNull();

    await ensureJwt(deps);
    expect(signPersonalMessage).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('clears the in-flight entry on failure so a subsequent ensureJwt retries', async () => {
    const failing = { backendUrl: BACKEND, address: ADDRESS, signPersonalMessage, fetchImpl: makeFetch({ verifyStatus: 401 }) };
    await expect(ensureJwt(failing)).rejects.toThrow('auth/verify rejected: HTTP 401');
    expect(getJwt(ADDRESS)).toBeNull();

    const ok = { backendUrl: BACKEND, address: ADDRESS, signPersonalMessage, fetchImpl: makeFetch() };
    await expect(ensureJwt(ok)).resolves.toBe('jwt.token');
    expect(getJwt(ADDRESS)).toBe('jwt.token');
  });
});
